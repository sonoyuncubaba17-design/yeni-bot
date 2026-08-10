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

// ==================== KATALOG ====================
const katalog = [
  { id: '1', title: 'Never Gonna Give You Up', artist: 'Rick Astley', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: '2', title: 'Shape of You', artist: 'Ed Sheeran', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: '3', title: 'Blinding Lights', artist: 'The Weeknd', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: '4', title: 'Believer', artist: 'Imagine Dragons', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { id: '5', title: 'Someone You Loved', artist: 'Lewis Capaldi', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' }
];

const queue = new Map();

client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} aktif!`);

  const commands = [
    new SlashCommandBuilder()
      .setName('katalog')
      .setDescription('Şarkı kataloğunu aç'),
    new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Müziği durdur'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Şarkıyı atla')
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

  try {
    console.log('Komutlar yükleniyor...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Komutlar yüklendi!');
  } catch (err) {
    console.error('Komut yükleme hatası:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  // Slash komutlar
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    const voiceChannel = interaction.member.voice.channel;
    const guildId = interaction.guildId;

    // /katalog
    if (commandName === 'katalog') {
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Önce bir ses kanalına gir!', ephemeral: true });
      }

      const options = katalog.map(song =>
        new StringSelectMenuOptionBuilder()
          .setLabel(song.title.substring(0, 100))
          .setDescription(song.artist.substring(0, 100))
          .setValue(song.id)
      );

      const menu = new StringSelectMenuBuilder()
        .setCustomId('sarki_sec')
        .setPlaceholder('Şarkı seç...')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(menu);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 Şarkı Kataloğu')
        .setDescription('Aşağıdan istediğin şarkıyı seç:');

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // /stop
    if (commandName === 'stop') {
      const serverQueue = queue.get(guildId);
      if (!serverQueue) return interaction.reply({ content: '❌ Çalan bir şey yok.', ephemeral: true });

      serverQueue.songs = [];
      serverQueue.player.stop();
      serverQueue.connection.destroy();
      queue.delete(guildId);
      return interaction.reply('⏹️ Durduruldu.');
    }

    // /skip
    if (commandName === 'skip') {
      const serverQueue = queue.get(guildId);
      if (!serverQueue) return interaction.reply({ content: '❌ Çalan bir şey yok.', ephemeral: true });

      serverQueue.player.stop();
      return interaction.reply('⏭️ Atlandı.');
    }
  }

  // Select Menu seçildiğinde
  if (interaction.isStringSelectMenu() && interaction.customId === 'sarki_sec') {
    await interaction.deferUpdate();

    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.followUp({ content: '❌ Ses kanalına gir!', ephemeral: true });
    }

    const song = katalog.find(s => s.id === interaction.values[0]);
    if (!song) return;

    const guildId = interaction.guildId;

    if (!queue.has(guildId)) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId,
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
        const q = queue.get(guildId);
        if (!q) return;
        q.songs.shift();
        if (q.songs.length > 0) playSong(guildId, q.songs[0]);
        else {
          q.connection.destroy();
          queue.delete(guildId);
        }
      });

      playSong(guildId, song);
    } else {
      queue.get(guildId).songs.push(song);
      return interaction.followUp({ content: `📥 **${song.title}** sıraya eklendi.` });
    }

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('🎵 Çalıyor')
      .setDescription(`**${song.title}** - ${song.artist}`);

    interaction.followUp({ embeds: [embed] });
  }
});

function playSong(guildId, song) {
  const q = queue.get(guildId);
  if (!q) return;

  try {
    const resource = createAudioResource(song.url, {
      inputType: StreamType.Arbitrary
    });
    q.player.play(resource);

    q.textChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎵 Şimdi Çalıyor')
          .setDescription(`**${song.title}** - ${song.artist}`)
      ]
    }).catch(() => {});
  } catch (err) {
    console.error(err);
    q.textChannel.send('❌ Şarkı çalınamadı.').catch(() => {});
  }
}

client.login(process.env.TOKEN);
