const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, PermissionFlagsBits
} = require("discord.js");
const { truncate } = require("../../core/utils/common");
const { containerPayload } = require("../../core/utils/componentsV2");
const variables = require("../../core/utils/variables");
const variableData = require("../../core/utils/variableData");

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger
};

/**
 * يحوّل الإمبيدات المخزّنة إلى رسائل ديسكورد حقيقية.
 *
 * المكوّنات (أزرار/قوائم) تُخزَّن كبيانات، ويُبنى منها `customId`
 * يحمل معرّف الإمبيد ورقم المكوّن فقط. الإجراء الفعلي يُقرأ من قاعدة البيانات
 * وقت الضغط، فلا يستطيع أحد تزوير التفاعل ليحصل على إجراء غير مُعرَّف في اللوحة.
 */
class EmbedService {
  constructor(app) {
    this.app = app;
  }

  /** يبني كائن EmbedBuilder من البيانات المحفوظة، مع احترام حدود ديسكورد. */
  build(embedRecord, { member = null, guild = null } = {}) {
    const d = embedRecord.data || {};
    const embed = new EmbedBuilder();
    let hasContent = false;

    const fill = (text) => this.replaceVariables(text, { member, guild });

    if (d.title) { embed.setTitle(truncate(fill(d.title), 256)); hasContent = true; }
    if (d.description) { embed.setDescription(truncate(fill(d.description), 4096)); hasContent = true; }
    if (d.url) embed.setURL(d.url);
    embed.setColor(typeof d.color === "number" ? d.color : this.app.config.color("primary"));

    if (d.author?.name) {
      embed.setAuthor({
        name: truncate(fill(d.author.name), 256),
        iconURL: d.author.icon || undefined,
        url: d.author.url || undefined
      });
      hasContent = true;
    }
    if (d.thumbnail) { embed.setThumbnail(d.thumbnail); hasContent = true; }
    if (d.image) { embed.setImage(d.image); hasContent = true; }
    if (d.footer?.text) {
      embed.setFooter({ text: truncate(fill(d.footer.text), 2048), iconURL: d.footer.icon || undefined });
      hasContent = true;
    }
    if (d.timestamp) embed.setTimestamp();

    if (Array.isArray(d.fields) && d.fields.length) {
      embed.addFields(
        d.fields.slice(0, 25).map((f) => ({
          name: truncate(fill(f.name) || "\u200b", 256),
          value: truncate(fill(f.value) || "\u200b", 1024),
          inline: !!f.inline
        }))
      );
      hasContent = true;
    }

    // ديسكورد يرفض الإمبيد الفارغ تمامًا
    if (!hasContent) embed.setDescription("*(هذا الإمبيد فارغ — عدّله لإضافة محتوى)*");
    return embed;
  }

  /**
   * المتغيرات داخل نصوص الإمبيد.
   * تمر عبر النظام الموحّد (41 متغيرًا، غير حسّاس لحالة الأحرف)،
   * فنفس المتغير يعمل هنا وفي الترحيب والردود التلقائية والأوامر المخصصة.
   */
  replaceVariables(text, { member, guild, channel, role, ...rest } = {}) {
    if (!text) return text;
    const ctx = variables.buildContext({
      member,
      guild: guild || member?.guild,
      channel,
      role,
      client: this.app.client,
      prefix: guild ? this.app.guildConfig.value(guild.id, "prefix") : null,
      ...rest
    });
    // متغيرات الإحصاءات ({XP} {BALANCE} ...) تُملأ من قاعدة البيانات فقط إن استُخدمت في النص
    return variables.apply(String(text), variableData.enrich(this.app, ctx, text));
  }

  /** يبني صفوف الأزرار والقوائم من البيانات المحفوظة. */
  buildComponents(embedRecord) {
    const rows = [];
    const components = embedRecord.components || [];

    for (let index = 0; index < components.length; index++) {
      const item = components[index];

      if (item.type === "button") {
        // زر الرابط لا يحمل customId إطلاقًا (شرط من ديسكورد)
        const button = item.action?.type === "link"
          ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(item.action.value)
          : new ButtonBuilder()
              .setCustomId(`ce:btn:${embedRecord.id}:${index}`)
              .setStyle(STYLES[item.style] || ButtonStyle.Secondary);

        button.setLabel(truncate(item.label || "زر", 80));
        if (item.emoji) {
          try { button.setEmoji(item.emoji); } catch { /* إيموجي غير صالح يُتجاهل */ }
        }

        // ديسكورد يسمح بـ 5 أزرار في الصف الواحد
        const last = rows[rows.length - 1];
        if (last && last._kind === "buttons" && last.components.length < 5) last.addComponents(button);
        else {
          const row = new ActionRowBuilder().addComponents(button);
          row._kind = "buttons";
          rows.push(row);
        }
      }

      if (item.type === "select") {
        const options = (item.options || []).slice(0, 25).map((o, i) => ({
          label: truncate(o.label || `خيار ${i + 1}`, 100),
          description: o.description ? truncate(o.description, 100) : undefined,
          emoji: o.emoji || undefined,
          value: String(i)
        }));
        if (!options.length) continue;

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`ce:sel:${embedRecord.id}:${index}`)
          .setPlaceholder(truncate(item.placeholder || "اختر", 150))
          .addOptions(options);

        const row = new ActionRowBuilder().addComponents(menu);
        row._kind = "select";
        rows.push(row);
      }
    }

    return rows.slice(0, 5); // حد ديسكورد: 5 صفوف لكل رسالة
  }

  /**
   * يبني الشكل الحديث (Components v2): حاوية ملوّنة واحدة تضم النص والصور
   * **والأزرار داخلها**، بدل الإمبيد التقليدي الذي تظهر أزراره منفصلة تحته.
   *
   * ديسكورد يمنع خلط هذا النمط مع `embeds` أو `content`، لذلك يُبنى كل المحتوى
   * (العنوان، الوصف، الحقول، الفوتر) كنص واحد منسّق داخل الحاوية.
   */
  buildContainerPayload(embedRecord, { member = null, guild = null, allowMentions = false } = {}) {
    const d = embedRecord.data || {};
    const fill = (text) => this.replaceVariables(text, { member, guild });
    const parts = [];

    if (d.author?.name) parts.push(`-# ${fill(d.author.name)}`);
    if (d.title) parts.push(`## ${fill(d.title)}`);
    if (d.description) parts.push(fill(d.description));

    if (Array.isArray(d.fields) && d.fields.length) {
      const fields = d.fields
        .slice(0, 25)
        .map((f) => `**${fill(f.name) || "\u200b"}**\n${fill(f.value) || "\u200b"}`)
        .join("\n\n");
      parts.push(fields);
    }

    if (d.footer?.text) parts.push(`-# ${fill(d.footer.text)}`);

    const text = parts.join("\n\n").trim() || "*(هذا الإمبيد فارغ — عدّله لإضافة محتوى)*";

    // الصورة الكبيرة تُعرض كمعرض وسائط داخل الحاوية، والمصغّرة لا مقابل لها في v2
    const images = [d.image, d.thumbnail].filter(Boolean);

    const payload = containerPayload({
      text,
      color: typeof d.color === "number" ? d.color : this.app.config.color("primary"),
      images,
      rows: this.buildComponents(embedRecord)
    });

    payload.allowedMentions = allowMentions
      ? { parse: ["users", "roles", "everyone"] }
      : { parse: ["users"] };

    return payload;
  }

  /** الحمولة الجاهزة للإرسال — تختار الشكل التقليدي أو الحديث حسب إعداد الإمبيد. */
  payload(embedRecord, { member = null, guild = null, allowMentions = false } = {}) {
    if (embedRecord.use_v2) {
      return this.buildContainerPayload(embedRecord, { member, guild, allowMentions });
    }

    // حد ديسكورد لنص الرسالة 2000 حرف، والقص هنا يمنع فشل الإرسال
    const content = embedRecord.content
      ? truncate(this.replaceVariables(embedRecord.content, { member, guild }), 2000)
      : undefined;

    return {
      content,
      embeds: [this.build(embedRecord, { member, guild })],
      components: this.buildComponents(embedRecord),
      // المنشنات الجماعية معطّلة افتراضيًا لمنع الإزعاج غير المقصود
      allowedMentions: allowMentions
        ? { parse: ["users", "roles", "everyone"] }
        : { parse: ["users"] }
    };
  }

  /** يُعيد نشر التعديلات على كل الرسائل التي أُرسلت من هذا الإمبيد. */
  async syncMessages(embedRecord) {
    const tracked = this.app.embeds.messages(embedRecord.id);
    let updated = 0;
    let removed = 0;

    for (const record of tracked) {
      const channel = await this.app.client.channels.fetch(record.channel_id).catch(() => null);
      if (!channel?.isTextBased()) {
        this.app.embeds.untrackMessage(record.message_id);
        removed++;
        continue;
      }
      const message = await channel.messages.fetch(record.message_id).catch(() => null);
      if (!message) {
        // الرسالة حُذفت يدويًا — نظّف السجل بدل محاولة تعديلها كل مرة
        this.app.embeds.untrackMessage(record.message_id);
        removed++;
        continue;
      }
      const payload = this.payload(embedRecord, { guild: channel.guild });
      // الحمولة تُمرَّر كما هي حتى يعمل الشكل الحديث (v2) الذي لا يقبل embeds/content
      const ok = await message.edit(
        payload.flags
          ? { flags: payload.flags, components: payload.components }
          : { content: payload.content ?? null, embeds: payload.embeds, components: payload.components }
      ).catch(() => null);
      if (ok) updated++;
    }

    return { updated, removed, total: tracked.length };
  }

  /**
   * ينفّذ إجراء مكوّن بعد التحقق منه من الخادم.
   * `action` يأتي من قاعدة البيانات وليس من المستخدم.
   */
  async runAction(interaction, action) {
    if (!action || !action.type) {
      return interaction.reply({ content: `${this.app.config.emoji("warning")} هذا الزر بلا إجراء محدد.`, flags: 64 });
    }

    if (action.type === "embed") {
      const target = this.app.embeds.get(action.value) || this.app.embeds.getByName(interaction.guild.id, action.value);
      if (!target || target.guild_id !== interaction.guild.id) {
        return interaction.reply({ content: `${this.app.config.emoji("error")} الإمبيد المرتبط لم يعد موجودًا.`, flags: 64 });
      }
      const payload = this.payload(target, { member: interaction.member, guild: interaction.guild });
      // مع الشكل الحديث تُدمج أعلام الحاوية مع علم الإخفاء (64) بعملية OR
      if (payload.flags) {
        return interaction.reply({
          flags: action.public ? payload.flags : payload.flags | 64,
          components: payload.components,
          allowedMentions: { parse: [] }
        });
      }
      return interaction.reply({
        content: payload.content,
        embeds: payload.embeds,
        components: payload.components,
        allowedMentions: { parse: [] },
        flags: action.public ? undefined : 64
      });
    }

    if (action.type === "text") {
      return interaction.reply({
        content: truncate(this.replaceVariables(action.value, { member: interaction.member, guild: interaction.guild }), 2000),
        allowedMentions: { parse: [] },
        flags: action.public ? undefined : 64
      });
    }

    if (action.type === "role") {
      return this._toggleRole(interaction, action.value);
    }

    // فتح تذكرة من نوع محدد، مع نموذج الأسئلة إن وُجد
    if (action.type === "ticket") {
      const tickets = require("../tickets/interactions");
      return tickets.openTypedTicket(interaction, this.app, action.value);
    }

    // بدء تقديم على نوع محدد
    if (action.type === "apply") {
      const applications = require("../applications/interactions");
      return applications.startApplication(interaction, this.app, action.value);
    }

    // بدء اختبار التفعيل
    if (action.type === "quiz") {
      const quiz = require("../quiz/interactions");
      return quiz.startQuiz(interaction, this.app);
    }

    // إجراء يشغّل نظامًا حقيقيًا (بنك، مخالفات، طيران)
    if (action.type === "system") {
      const systemActions = require("../economy/interactions");
      return systemActions.run(interaction, this.app, action.value);
    }

    return interaction.reply({ content: `${this.app.config.emoji("error")} نوع إجراء غير معروف.`, flags: 64 });
  }

  /** إعطاء أو سحب رتبة، بنفس ضمانات نظام الرتب الذاتية. */
  async _toggleRole(interaction, roleId) {
    const guild = interaction.guild;
    const role = guild.roles.cache.get(roleId);
    const me = guild.members.me;

    if (!role) return interaction.reply({ content: `${this.app.config.emoji("error")} الرتبة لم تعد موجودة.`, flags: 64 });
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: `${this.app.config.emoji("error")} البوت يفتقد صلاحية إدارة الرتب.`, flags: 64 });
    }
    if (role.managed || role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `${this.app.config.emoji("error")} لا أستطيع إدارة هذه الرتبة.`, flags: 64 });
    }
    if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: `${this.app.config.emoji("error")} لا يُسمح بتوزيع رتبة إدارية عبر الأزرار.`, flags: 64 });
    }

    const has = interaction.member.roles.cache.has(roleId);
    if (has) {
      await interaction.member.roles.remove(role, "زر رتبة").catch(() => {});
      return interaction.reply({ content: `➖ تمت إزالة <@&${roleId}>`, flags: 64 });
    }
    await interaction.member.roles.add(role, "زر رتبة").catch(() => {});
    return interaction.reply({ content: `${this.app.config.emoji("success")} تمت إضافة <@&${roleId}>`, flags: 64 });
  }
}

module.exports = EmbedService;
module.exports.STYLES = STYLES;
