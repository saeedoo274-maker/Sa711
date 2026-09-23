const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed } = require("../../core/utils/helpers");

/**
 * اختبار التفعيل.
 *
 * أسئلة نعم/لا متسلسلة بأزرار. الجلسة في الذاكرة لأنها قصيرة العمر،
 * والنتيجة فقط تُحفظ في قاعدة البيانات.
 */
class QuizService {
  constructor(app) {
    this.app = app;
    this.sessions = new Map(); // `${guildId}:${userId}` -> session
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "quiz") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  start(guildId, userId) {
    const questions = this.app.quiz.list(guildId);
    if (!questions.length) return { ok: false, reason: "noQuestions" };

    const session = { questions, index: 0, score: 0, startedAt: Date.now() };
    this.sessions.set(this.key(guildId, userId), session);
    return { ok: true, session };
  }

  get(guildId, userId) {
    return this.sessions.get(this.key(guildId, userId)) || null;
  }

  questionPayload(session, userId) {
    const q = session.questions[session.index];
    return {
      embeds: [
        buildEmbed({
          description: `**السؤال ${session.index + 1} / ${session.questions.length}**\n\n${q.text}`,
          color: this.app.config.color("primary"),
          timestamp: false
        })
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`quiz:answer:${userId}:yes`).setLabel("نعم").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`quiz:answer:${userId}:no`).setLabel("لا").setStyle(ButtonStyle.Danger)
        )
      ]
    };
  }

  /** يسجّل الإجابة ويتقدّم. يُرجع النتيجة عند انتهاء الأسئلة. */
  answer(guildId, userId, value) {
    const session = this.get(guildId, userId);
    if (!session) return { ok: false, reason: "noSession" };

    const q = session.questions[session.index];
    if (String(q.correct).toLowerCase() === value) session.score++;
    session.index++;

    if (session.index < session.questions.length) return { ok: true, done: false, session };

    this.sessions.delete(this.key(guildId, userId));

    const total = session.questions.length;
    const cfg = this.config(guildId);
    const required = cfg.passScore || Math.ceil(total * 0.7);
    const passed = session.score >= required;

    this.app.quiz.recordAttempt({ guildId, userId, score: session.score, total, passed });
    return { ok: true, done: true, score: session.score, total, required, passed };
  }

  resultEmbed(guildId, member, result) {
    return buildEmbed({
      title: "نتيجة اختبار التفعيل",
      color: this.app.config.color(result.passed ? "success" : "danger"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الإجابات الصحيحة", value: `\`${result.score}\``, inline: true },
        { name: "الإجابات الخاطئة", value: `\`${result.total - result.score}\``, inline: true },
        { name: "المطلوب للنجاح", value: `\`${result.required}\` من \`${result.total}\``, inline: true }
      ],
      description: result.passed
        ? "✅ | مبروك، لقد اجتزت اختبار التفعيل!"
        : "❌ | للأسف لم تجتز الاختبار. راجع القوانين وحاول مرة أخرى."
    });
  }

  /** يعطي رتبة التفعيل بعد النجاح. */
  async grantRole(guild, member) {
    const roleId = this.config(guild.id).passRoleId;
    if (!roleId) return null;

    const role = guild.roles.cache.get(roleId);
    const me = guild.members.me;
    if (!role) return "رتبة التفعيل محذوفة.";
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "البوت يفتقد صلاحية إدارة الرتب.";
    if (role.managed || role.position >= me.roles.highest.position) return `رتبة البوت أقل من <@&${role.id}>.`;
    if (member.roles.cache.has(role.id)) return null;

    await member.roles.add(role, "اجتياز اختبار التفعيل").catch(() => {});
    return null;
  }
}

module.exports = QuizService;
