const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { buildEmbed, timestamp, truncate } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * الهوية الوطنية.
 *
 * البطاقة تُعرض بطريقتين حسب المتاح:
 *   1. **صورة مرسومة** إن كانت مكتبة `canvas` مثبّتة وحُدِّدت صورة قالب.
 *   2. **بطاقة منسّقة** (Components v2) إن لم تتوفر — وهي الوضع الافتراضي.
 *
 * لماذا هذا التصميم: مكتبة الرسم تحتاج بناءً أصليًا قد يفشل على بعض الاستضافات،
 * فلا يصح أن يتعطّل النظام كله بسببها. كل الإحداثيات والألوان قابلة للتعديل
 * من إعدادات السيرفر، فتقدر ترفع قالبك وتضبط مواضع النص متى شئت بلا لمس الكود.
 */

/** مواضع النص الافتراضية على القالب. كلها قابلة للتعديل من `identity.layout`. */
const DEFAULT_LAYOUT = {
  photo: { x: 605, y: 536, w: 250, h: 250, circular: true },
  fields: {
    full_name: { x: 1490, y: 303, size: 60, align: "right" },
    card_number: { x: 1490, y: 443, size: 70, align: "right" },
    birth_date: { x: 1285, y: 573, size: 70, align: "right" },
    birth_place: { x: 1235, y: 690, size: 70, align: "right" },
    job: { x: 1400, y: 822, size: 70, align: "right" },
    issued_at: { x: 1460, y: 1042, size: 40, align: "right" },
    expires_at: { x: 480, y: 1042, size: 40, align: "right" }
  },
  color: "#000001",
  font: "sans-serif"
};

class IdentityService {
  constructor(app) {
    this.app = app;
    this._canvasChecked = false;
    this._canvas = null;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "identity") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  layout(guildId) {
    const custom = this.config(guildId).layout || {};
    return {
      ...DEFAULT_LAYOUT,
      ...custom,
      photo: { ...DEFAULT_LAYOUT.photo, ...(custom.photo || {}) },
      fields: { ...DEFAULT_LAYOUT.fields, ...(custom.fields || {}) }
    };
  }

  /** يحمّل مكتبة الرسم مرة واحدة فقط، ويتذكّر غيابها بلا محاولات متكررة. */
  canvasLib() {
    if (this._canvasChecked) return this._canvas;
    this._canvasChecked = true;
    try {
      this._canvas = require("canvas-constructor/cairo");
    } catch {
      try {
        this._canvas = require("canvas-constructor/skia");
      } catch {
        this._canvas = null;
      }
    }
    return this._canvas;
  }

  /** هل يمكن رسم البطاقة كصورة الآن؟ يحتاج المكتبة **و** صورة قالب. */
  canRenderImage(guildId) {
    return !!this.canvasLib() && !!this.config(guildId).templateUrl;
  }

  // ---------------- عرض البطاقة ----------------

  /**
   * يبني البطاقة بأفضل شكل متاح.
   * @returns {Promise<{files?: AttachmentBuilder[], payload?: object}>}
   */
  async renderCard(guild, identity, user) {
    if (this.canRenderImage(guild.id)) {
      const file = await this._renderImage(guild, identity, user).catch((err) => {
        this.app.logger.warn(`فشل رسم بطاقة الهوية، سنعرضها منسّقة: ${err.message}`);
        return null;
      });
      if (file) return { files: [file] };
    }
    return { payload: this.cardPayload(guild, identity, user) };
  }

  async _renderImage(guild, identity, user) {
    const lib = this.canvasLib();
    const cfg = this.config(guild.id);
    const layout = this.layout(guild.id);

    const template = await lib.loadImage(cfg.templateUrl);
    const canvas = new lib.Canvas(template.width, template.height).printImage(template, 0, 0, template.width, template.height);

    // الصورة الشخصية: من بيانات الهوية أو أفاتار العضو
    const photoUrl = identity.photo_url || user?.displayAvatarURL?.({ extension: "png" });
    if (photoUrl) {
      const photo = await lib.loadImage(photoUrl).catch(() => null);
      if (photo) {
        const p = layout.photo;
        if (p.circular) canvas.printCircularImage(photo, p.x, p.y, p.w / 2);
        else canvas.printImage(photo, p.x, p.y, p.w, p.h);
      }
    }

    const values = {
      full_name: identity.full_name,
      card_number: String(identity.card_number).padStart(6, "0"),
      birth_date: identity.birth_date || "—",
      birth_place: identity.birth_place || "—",
      job: identity.job || "—",
      nationality: identity.nationality || "—",
      gender: identity.gender || "—",
      issued_at: identity.issued_at ? new Date(identity.issued_at).toLocaleDateString("ar") : "—",
      expires_at: identity.expires_at ? new Date(identity.expires_at).toLocaleDateString("ar") : "—"
    };

    for (const [key, pos] of Object.entries(layout.fields)) {
      const text = values[key];
      if (text === undefined) continue;
      canvas
        .setColor(pos.color || layout.color)
        .setTextAlign(pos.align || "right")
        .setTextFont(`${pos.size || 50}px ${pos.font || layout.font}`)
        .printText(String(text), pos.x, pos.y);
    }

    return new AttachmentBuilder(await canvas.toBuffer("png"), { name: `identity-${identity.card_number}.png` });
  }

  /** البطاقة المنسّقة — الوضع الافتراضي بلا أي مكتبة أو صورة. */
  cardPayload(guild, identity, user) {
    const expired = identity.expires_at && identity.expires_at < Date.now();

    const text =
      `## 🪪 الهوية الوطنية — ${guild.name}\n\n` +
      `**رقم الهوية:** \`${String(identity.card_number).padStart(6, "0")}\`\n` +
      `**الاسم:** ${identity.full_name}\n` +
      (identity.birth_date ? `**تاريخ الميلاد:** ${identity.birth_date}\n` : "") +
      (identity.birth_place ? `**مكان الميلاد:** ${identity.birth_place}\n` : "") +
      (identity.gender ? `**الجنس:** ${identity.gender}\n` : "") +
      (identity.nationality ? `**الجنسية:** ${identity.nationality}\n` : "") +
      (identity.job ? `**المهنة:** ${identity.job}\n` : "") +
      `**الحامل:** <@${identity.user_id}>\n\n` +
      `-# صدرت ${identity.issued_at ? timestamp(identity.issued_at, "D") : "—"}` +
      (identity.expires_at ? ` • تنتهي ${timestamp(identity.expires_at, "D")}${expired ? " ⚠️ **منتهية**" : ""}` : "");

    const images = [];
    if (identity.photo_url) images.push(identity.photo_url);

    return containerPayload({
      text,
      color: expired ? this.app.config.color("danger") : this.app.config.color("success"),
      images
    });
  }

  // ---------------- المراجعة ----------------

  reviewEmbed(guild, identity, user) {
    const status = { pending: "⏳ بانتظار المراجعة", approved: "✅ معتمدة", rejected: "❌ مرفوضة" }[identity.status];
    const fields = [
      { name: "مقدّم الطلب", value: `<@${identity.user_id}>`, inline: true },
      { name: "رقم الهوية", value: `\`${String(identity.card_number).padStart(6, "0")}\``, inline: true },
      { name: "الحالة", value: status, inline: true },
      { name: "الاسم الكامل", value: identity.full_name }
    ];
    if (identity.birth_date) fields.push({ name: "تاريخ الميلاد", value: identity.birth_date, inline: true });
    if (identity.birth_place) fields.push({ name: "مكان الميلاد", value: identity.birth_place, inline: true });
    if (identity.gender) fields.push({ name: "الجنس", value: identity.gender, inline: true });
    if (identity.nationality) fields.push({ name: "الجنسية", value: identity.nationality, inline: true });
    if (identity.job) fields.push({ name: "المهنة", value: identity.job, inline: true });
    if (identity.reject_reason) fields.push({ name: "سبب الرفض", value: truncate(identity.reject_reason, 500) });

    return buildEmbed({
      title: "🪪 طلب هوية وطنية",
      color: this.app.config.color(identity.status === "approved" ? "success" : identity.status === "rejected" ? "danger" : "warning"),
      thumbnail: identity.photo_url || user?.displayAvatarURL?.() || undefined,
      fields
    });
  }

  reviewButtons(identity) {
    if (identity.status !== "pending") return [];
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`idn:approve:${identity.id}`).setLabel("قبول").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`idn:reject:${identity.id}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Danger)
      )
    ];
  }

  async refreshReview(guild, identity) {
    if (!identity.channel_id || !identity.message_id) return;
    const channel = await this.app.client.channels.fetch(identity.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(identity.message_id).catch(() => null);
    if (!message) return;

    const user = await this.app.client.users.fetch(identity.user_id).catch(() => null);
    await message
      .edit({ embeds: [this.reviewEmbed(guild, identity, user)], components: this.reviewButtons(identity) })
      .catch(() => {});
  }

  /** لوحة إنشاء الهوية التي تُنشر في قناة عامة. */
  panelPayload(guild) {
    return containerPayload({
      text:
        "## 🪪 الأحوال المدنية\n\n" +
        "— أهلاً بك عزيزي العضو.\n" +
        "— لإنشاء هويتك الوطنية اضغط الزر بالأسفل واملأ البيانات.\n" +
        "— بعد مراجعة الطلب ستصلك بطاقتك في الخاص.\n\n" +
        `-# ⚠️ هذا النموذج سيُرسل إلى إدارة **${guild.name}** — لا تشارك كلمات مرور أو معلومات حساسة.`,
      color: 0xC9A227,
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("idn:create").setLabel("إنشاء هوية").setEmoji("🪪").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("idn:mine").setLabel("عرض هويتي").setEmoji("👤").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
}

module.exports = IdentityService;
module.exports.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
