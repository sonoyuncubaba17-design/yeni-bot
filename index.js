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
  StringSelectMenuOptionBuilder
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
app.get('/', (req, res) => res.send('DS Music Bot Aktif!'));
app.listen(PORT, () => console.log(`Port ${PORT} dinleniyor`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==================== ŞARKI KATALOĞU ====================
const katalog = [
  { id: '1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: '2', title: 'Shape of You', artist: 'Ed Sheeran', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: '3', title: 'Blinding Lights', artist: 'The Weeknd', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: '4', title: 'Believer', artist: 'Imagine Dragons', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: '5', title: 'Someone You Loved', artist: 'Lewis Capaldi', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { id: '6', title: 'Dance Monkey', artist: 'Tones and I', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  { id: '7', title: 'Bad Guy', artist: 'Billie Eilish', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3' },
  { id: '8', title: 'Old Town Road', artist: 'Lil Nas X', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3' }
];

const queue = new Map();

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} aktif!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('katalog')
      .setDescription('DS Music şarkı kataloğunu aç'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Müziği durdur ve kanaldan çık'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Şarkıyı atla')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Komutlar yüklendi!');
  } catch (err) {
    console.error(err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    const voiceChannel = interaction.member.voice.channel;
    const guildId = interaction.guildId;

    // ==================== /katalog ====================
    if (commandName === 'katalog') {
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Önce bir ses kanalına girmen gerekiyor!', ephemeral: true });
      }

      const options = katalog.map(song =>
        new StringSelectMenuOptionBuilder()
          .setLabel(song.title.substring(0, 100))
          .setDescription(song.artist.substring(0, 100))
          .setValue(song.id)
          .setEmoji('🎵')
      );

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sarki_sec')
        .setPlaceholder('Şarkı seçerek dinlemeye başla...')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
          name: 'DS MUSIC • Müzik Kataloğu',
          iconURL: client.user.displayAvatarURL()
        })
        .setTitle('🎵 Şarkı Seç')
        .setDescription(
          'Aşağıdaki menüden dinlemek istediğin şarkıyı seçebilirsin.\n\n' +
          '**Kurallar**\n' +
          '• Aynı anda sadece **1** şarkı çalabilir\n' +
          '• Ses kanalında olman gerekir\n' +
          '• Şarkı bitince otomatik sıradakine geçer\n\n' +
          'İyi dinlemeler!'
        )
        .setFooter({ text: 'DS MUSIC • Profesyonel Müzik Sistemi' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // ==================== /stop ====================
    if (commandName === 'stop') {
      const q = queue.get(guildId);
      if (!q) return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });

      q.songs = [];
      q.player.stop();
      q.connection.destroy();
      queue.delete(guildId);
      return interaction.reply('⏹️ Müzik durduruldu ve kanaldan çıkıldı.');
    }

    // ==================== /skip ====================
    if (commandName === 'skip') {
      const q = queue.get(guildId);
      if (!q) return interaction.reply({ content: '❌ Şu an çalan bir şey yok.', ephemeral: true });

      q.player.stop();
      return interaction.reply('⏭️ Şarkı atlandı.');
    }
  }

  // ==================== Şarkı seçildiğinde ====================
  if (interaction.isStringSelectMenu() && interaction.customId === 'sarki_sec') {
    await interaction.deferUpdate();

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.followUp({ content: '❌ Ses kanalına girmen gerekiyor!', ephemeral: true });
    }

    const song = katalog.find(s => s.id === interaction.values[0]);
    if (!song) return;

    const guildId = interaction.guildId;

    try {
      if (!queue.has(guildId)) {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
        });

        connection.on('stateChange', (oldState, newState) => {
          console.log(`Bağlantı: ${oldState.status} → ${newState.status}`);
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
          const q = queue.get(guildId);
          if (!q) return;
          q.songs.shift();
          if (q.songs.length > 0) {
            playSong(guildId, q.songs[0]);
          } else {
            q.connection.destroy();
            queue.delete(guildId);
          }
        });

        player.on('error', error => {
          console.error('Player hatası:', error);
        });

        setTimeout(() => playSong(guildId, song), 1500);
      } else {
        queue.get(guildId).songs.push(song);
        return interaction.followUp({ content: `📥 **${song.title}** sıraya eklendi.` });
      }

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: 'DS MUSIC', iconURL: client.user.displayAvatarURL() })
        .setTitle('🎵 Şimdi Çalıyor')
        .setDescription(`**${song.title}**\n${song.artist}`)
        .setFooter({ text: `İsteyen: ${interaction.user.tag}` })
        .setTimestamp();

      interaction.followUp({ embeds: [embed] });
    } catch (err) {
      console.error('Bağlantı hatası:', err);
      interaction.followUp({ content: '❌ Ses kanalına bağlanırken hata oluştu.', ephemeral: true });
    }
  }
});

async function playSong(guildId, song) {
  const q = queue.get(guildId);
  if (!q) return;

  try {
    console.log('Çalınıyor:', song.title);

    const resource = createAudioResource(song.url, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true
    });

    if (resource.volume) resource.volume.setVolume(1);

    q.player.play(resource);

    q.textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: 'DS MUSIC', iconURL: client.user.displayAvatarURL() })
          .setTitle('🎵 Şimdi Çalıyor')
          .setDescription(`**${song.title}**\n${song.artist}`)
          .setTimestamp()
      ]
    }).catch(() => {});
  } catch (err) {
    console.error('playSong hatası:', err);
    q.textChannel.send(`❌ Çalınamadı: ${err.message}`).catch(() => {});
  }
}

client.login(process.env.TOKEN);
