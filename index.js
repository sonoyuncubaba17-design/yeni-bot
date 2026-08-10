require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType
} = require('@discordjs/voice');
const ytdlp = require('yt-dlp-exec');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('DS Music Bot Aktif!');
});

app.listen(PORT, () => {
  console.log(`Port ${PORT} dinleniyor`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const queue = new Map();

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} müzik botu aktif!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Şarkı çal')
      .addStringOption(option =>
        option.setName('sarki')
          .setDescription('Şarkı adı veya YouTube linki')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Müziği durdur ve kanaldan çık'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Şarkıyı atla'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Sıradaki şarkıları göster'),
    new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Şu an çalan şarkıyı göster')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log('Slash komutlar yükleniyor...');
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('Slash komutlar yüklendi!');
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const guildId = interaction.guildId;
  const voiceChannel = interaction.member.voice.channel;

  if (['play', 'stop', 'skip'].includes(commandName) && !voiceChannel) {
    return interaction.reply({ content: '❌ Bir ses kanalına girmen gerekiyor!', ephemeral: true });
  }

  // ==================== PLAY ====================
  if (commandName === 'play') {
    await interaction.deferReply();

    const query = interaction.options.getString('sarki');
    let songInfo;

    try {
      // yt-dlp ile hem link hem arama destekler
      const info = await ytdlp(query, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
        defaultSearch: 'ytsearch1',   // arama için
        'no-playlist': true
      });

      songInfo = {
        title: info.title || 'Bilinmeyen Şarkı',
        url: info.webpage_url || info.url || query,
        duration: info.duration || 0,
        thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null
      };
    } catch (err) {
      console.error("PLAY HATASI:", err);
      return interaction.editReply(`❌ Şarkı alınırken hata oluştu.\n\`\`\`${err.message}\`\`\``);
    }

    const song = {
      title: songInfo.title,
      url: songInfo.url,
      duration: songInfo.duration,
      thumbnail: songInfo.thumbnail,
      requestedBy: interaction.user.tag
    };

    if (!queue.has(guildId)) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guildId,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      queue.set(guildId, {
        connection,
        player,
        songs: [song],
        textChannel: interaction.channel
      });

      player.on(AudioPlayerStatus.Idle, () => {
        const serverQueue = queue.get(guildId);
        if (!serverQueue) return;

        serverQueue.songs.shift();

        if (serverQueue.songs.length > 0) {
          playSong(guildId, serverQueue.songs[0]);
        } else {
          serverQueue.connection.destroy();
          queue.delete(guildId);
        }
      });

      player.on('error', error => {
        console.error(error);
        const serverQueue = queue.get(guildId);
        if (serverQueue) {
          serverQueue.connection.destroy();
          queue.delete(guildId);
        }
      });

      playSong(guildId, song);

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🎵 Şarkı Çalınıyor')
        .setDescription(`[${song.title}](${song.url})`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: 'Süre', value: formatTime(song.duration), inline: true },
          { name: 'İsteyen', value: song.requestedBy, inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } else {
      const serverQueue = queue.get(guildId);
      serverQueue.songs.push(song);

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📥 Sıraya Eklendi')
        .setDescription(`[${song.title}](${song.url})`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: 'Sıra', value: `${serverQueue.songs.length}`, inline: true },
          { name: 'İsteyen', value: song.requestedBy, inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    }
  }

  // ==================== STOP ====================
  if (commandName === 'stop') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) {
      return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });
    }

    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queue.delete(guildId);

    return interaction.reply('⏹️ Müzik durduruldu ve kanaldan çıkıldı.');
  }

  // ==================== SKIP ====================
  if (commandName === 'skip') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) {
      return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });
    }

    serverQueue.player.stop();
    return interaction.reply('⏭️ Şarkı atlandı.');
  }

  // ==================== QUEUE ====================
  if (commandName === 'queue') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
      return interaction.reply({ content: '❌ Sırada şarkı yok.', ephemeral: true });
    }

    const list = serverQueue.songs
      .map((song, i) => `**${i + 1}.** [${song.title}](${song.url}) - \`${formatTime(song.duration)}\``)
      .slice(0, 15)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📜 Şarkı Sırası')
      .setDescription(list)
      .setFooter({ text: `Toplam ${serverQueue.songs.length} şarkı` });

    return interaction.reply({ embeds: [embed] });
  }

  // ==================== NOW PLAYING ====================
  if (commandName === 'nowplaying') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
      return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });
    }

    const song = serverQueue.songs[0];

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🎶 Şu An Çalıyor')
      .setDescription(`[${song.title}](${song.url})`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Süre', value: formatTime(song.duration), inline: true },
        { name: 'İsteyen', value: song.requestedBy, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }
});

// ==================== ÇALMA FONKSİYONU (yt-dlp) ====================
async function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  try {
    const stream = ytdlp.exec(
      song.url,
      {
        o: '-',                    // stdout'a yaz
        q: true,                   // sessiz
        f: 'bestaudio[ext=webm]/bestaudio/best',
        'no-playlist': true,
        'no-warnings': true,
        r: '100K'                  // rate limit (isteğe bağlı)
      },
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const resource = createAudioResource(stream.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    serverQueue.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🎵 Şimdi Çalıyor')
      .setDescription(`[${song.title}](${song.url})`)
      .setThumbnail(song.thumbnail)
      .setFooter({ text: `İsteyen: ${song.requestedBy}` });

    serverQueue.textChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('playSong hatası:', err);
    serverQueue.textChannel.send('❌ Şarkı çalınırken hata oluştu.').catch(() => {});

    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      playSong(guildId, serverQueue.songs[0]);
    } else {
      serverQueue.connection.destroy();
      queue.delete(guildId);
    }
  }
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

client.login(process.env.TOKEN);
