require('dotenv').config();
const http = require('http');
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, PORT } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('DISCORD_TOKEN ve CLIENT_ID ortam değişkenleri gerekli!');
  process.exit(1);
}

// ---------- Komut tanımı ----------
const duyuruKomutu = new SlashCommandBuilder()
  .setName('duyuru')
  .setDescription('Seçilen kanala duyuru gönderir')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .setDMPermission(false)
  .addChannelOption((o) =>
    o
      .setName('kanal')
      .setDescription('Duyurunun gönderileceği kanal')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)
  )
  .addStringOption((o) =>
    o
      .setName('etiket')
      .setDescription('Etiketleme türü (varsayılan: yok)')
      .addChoices(
        { name: 'Etiket yok', value: 'yok' },
        { name: '@everyone', value: 'everyone' },
        { name: '@here', value: 'here' }
      )
  );

const commands = [duyuruKomutu.toJSON()];

// ---------- Client ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`${client.user.tag} olarak giriş yapıldı.`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    if (GUILD_ID) {
      // Sunucuya özel kayıt: anında aktif olur
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Komutlar sunucuya kaydedildi.');
    } else {
      // Global kayıt: yayılması biraz sürebilir
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Komutlar global olarak kaydedildi.');
    }
  } catch (err) {
    console.error('Komut kaydı başarısız:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // /duyuru -> modal aç
    if (interaction.isChatInputCommand() && interaction.commandName === 'duyuru') {
      const kanal = interaction.options.getChannel('kanal');
      const etiket = interaction.options.getString('etiket') ?? 'yok';

      const modal = new ModalBuilder()
        .setCustomId(`duyuru:${kanal.id}:${etiket}`)
        .setTitle('Yeni Duyuru');

      const baslik = new TextInputBuilder()
        .setCustomId('baslik')
        .setLabel('Başlık')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setRequired(true);

      const mesaj = new TextInputBuilder()
        .setCustomId('mesaj')
        .setLabel('Duyuru metni')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setRequired(true);

      const renk = new TextInputBuilder()
        .setCustomId('renk')
        .setLabel('Renk (hex, örn: #5865F2) - isteğe bağlı')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(7)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(baslik),
        new ActionRowBuilder().addComponents(mesaj),
        new ActionRowBuilder().addComponents(renk)
      );

      return await interaction.showModal(modal);
    }

    // Modal gönderildi -> duyuruyu yayınla
    if (interaction.isModalSubmit() && interaction.customId.startsWith('duyuru:')) {
      const [, kanalId, etiket] = interaction.customId.split(':');

      const baslik = interaction.fields.getTextInputValue('baslik');
      const mesaj = interaction.fields.getTextInputValue('mesaj');
      let renk = interaction.fields.getTextInputValue('renk')?.trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(renk || '')) renk = '#5865F2';
      if (!renk.startsWith('#')) renk = `#${renk}`;

      const kanal = await interaction.guild.channels.fetch(kanalId).catch(() => null);
      if (!kanal) {
        return interaction.reply({ content: '❌ Kanal bulunamadı.', flags: MessageFlags.Ephemeral });
      }

      // Botun kanalda yetkisi var mı?
      const izinler = kanal.permissionsFor(interaction.guild.members.me);
      if (!izinler?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply({
          content: '❌ Botun bu kanalda mesaj gönderme / bağlantı yerleştirme yetkisi yok.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(baslik)
        .setDescription(mesaj)
        .setColor(renk)
        .setFooter({
          text: `${interaction.user.tag} tarafından`,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTimestamp();

      const icerik = etiket === 'everyone' ? '@everyone' : etiket === 'here' ? '@here' : undefined;

      await kanal.send({
        content: icerik,
        embeds: [embed],
        allowedMentions: { parse: icerik ? ['everyone'] : [] },
      });

      return interaction.reply({
        content: `✅ Duyuru <#${kanal.id}> kanalına gönderildi.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error(err);
    const yanit = { content: '❌ Bir hata oluştu.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) interaction.followUp(yanit).catch(() => {});
    else interaction.reply(yanit).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);

// ---------- Render için basit web sunucusu ----------
// Render "Web Service" bir port dinlenmesini bekler; ayrıca UptimeRobot ile ping atılabilir.
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Duyuru botu çalışıyor.');
  })
  .listen(PORT || 3000, () => console.log(`Web sunucusu ${PORT || 3000} portunda.`));
