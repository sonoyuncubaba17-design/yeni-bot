require('dotenv').config();
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType
} = require('@discordjs/voice');

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

// ==================== KATALOG (istediğin kadar ekle) ====================
const katalog = [
  {
    id: '1',
    title: 'Never Gonna Give You Up',
    artist: 'Rick Astley',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' // örnek direkt link
  },
  {
    id: '2',
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  },
  {
    id: '3',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
  },
  {
    id: '4',
    title: 'Believer',
    artist: 'Imagine Dragons',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3'
  },
  {
    id: '5',
    title: 'Someone You Loved',
    artist: 'Lewis Capaldi',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3'
  }
];

// Gerçek şarkı eklemek istersen yukarıdaki gibi title + artist + direkt mp3 linki koyman yeterli.

const queue = new Map();

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} müzik botu aktif!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('katalog')
      .setDescription('Şarkı kataloğunu aç ve seç'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Müziği durdur ve kanaldan çık'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Şarkıyı atla')
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash komutlar yüklendi!');
  } catch (err) {
    console.error(err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isStringSelectMenu()) return;

  const guildId = interaction.guildId;
  const voiceChannel = interaction.member?.voice?.channel;

  // ==================== /katalog komutu ====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'katalog') {
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Önce bir ses kanalına gir!', ephemeral: true });
    }

    const options = katalog.map(song =>
      new StringSelectMenuOptionBuilder()
        .setLabel(song.title)
        .setDescription(song.artist)
        .setValue(song.id)
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId('katalog_sec')
      .setPlaceholder('Şarkı seç...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎵 Şarkı Kataloğu')
      .setDescription('Aşağıdaki menüden istediğin şarkıyı seç:');

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // ==================== Şarkı seçildiğinde ====================
  if (interaction.isStringSelectMenu() && interaction.customId === 'katalog_sec') {
    await interaction.deferUpdate();

    if (!voiceChannel) {
      return interaction.followUp({ content: '❌ Ses kanalından çıkmışsın!', ephemeral: true });
    }

    const secilenId = interaction.values[0];
    const song = katalog.find(s => s.id === secilenId);

    if (!song) {
      return interaction.followUp({ content: '❌ Şarkı bulunamadı.', ephemeral: true });
    }

    // Kuyruk yoksa yeni oluştur
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

      playSong(guildId, song);
    } else {
      // Zaten çalıyorsa sıraya ekle
      const serverQueue = queue.get(guildId);
      serverQueue.songs.push(song);
      return interaction.followUp({ content: `📥 **${song.title}** sıraya eklendi.` });
    }

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🎵 Çalıyor')
      .setDescription(`**${song.title}** - ${song.artist}`);

    return interaction.followUp({ embeds: [embed] });
  }

  // ==================== STOP ====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'stop') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) {
      return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });
    }
    serverQueue.songs = [];
    serverQueue.player.stop();
    serverQueue.connection.destroy();
    queue.delete(guildId);
    return interaction.reply('⏹️ Müzik durduruldu.');
  }

  // ==================== SKIP ====================
  if (interaction.isChatInputCommand() && interaction.commandName === 'skip') {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) {
      return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });
    }
    serverQueue.player.stop();
    return interaction.reply('⏭️ Şarkı atlandı.');
  }
});

// ==================== Çalma fonksiyonu ====================
function playSong(guildId, song) {
  const serverQueue = queue.get(guildId);
  if (!serverQueue) return;

  try {
    const resource = createAudioResource(song.url, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    serverQueue.player.play(resource);

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🎵 Şimdi Çalıyor')
      .setDescription(`**${song.title}** - ${song.artist}`);

    serverQueue.textChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error(err);
    serverQueue.textChannel.send('❌ Şarkı çalınamadı.').catch(() => {});
    serverQueue.songs.shift();
    if (serverQueue.songs.length > 0) {
      playSong(guildId, serverQueue.songs[0]);
    } else {
      serverQueue.connection.destroy();
      queue.delete(guildId);
    }
  }
}

client.login(process.env.TOKEN);
