const { buildEmbed, truncate } = require("../../core/utils/helpers");

const SESSION_TTL_MS = 15 * 60 * 1000; // ربع ساعة لإكمال النموذج

/**
 * جمع الإجابات عبر رسائل خاصة، سؤالاً بعد سؤال.
 *
 * لماذا لا نستخدم المودال دائمًا؟ لأن مودال ديسكورد محدود بـ5 حقول نصية فقط
 * ولا يقبل المرفقات إطلاقًا. هذا المسار يسمح بعدد أكبر من الأسئلة وبإرفاق صورة.
 *
 * الجلسات في الذاكرة عمدًا: نموذج نصف مكتمل ليس بيانات تستحق التخزين الدائم،
 * وتنتهي صلاحيته تلقائيًا. إعادة تشغيل البوت تلغي الجلسات المفتوحة، والعضو يبدأ من جديد.
 */
class DMFlowService {
  constructor(app) {
    this.app = app;
    this.sessions = new Map(); // userId -> session
    this.timer = setInterval(() => this.sweep(), 60_000);
    if (this.timer.unref) this.timer.unref();
  }

  sweep() {
    const now = Date.now();
    for (const [userId, session] of this.sessions) {
      if (now - session.startedAt > SESSION_TTL_MS) {
        this.sessions.delete(userId);
        session.user?.send({
          content: `${this.app.config.emoji("warning")} انتهت مهلة تعبئة النموذج. ابدأ من جديد متى ما حبيت.`
        }).catch(() => {});
      }
    }
  }

  has(userId) {
    return this.sessions.has(userId);
  }

  cancel(userId) {
    return this.sessions.delete(userId);
  }

  /**
   * يبدأ جلسة أسئلة في الخاص.
   * @returns {{ok:boolean, reason?:string}}
   */
  async start({ user, guild, title, intro, questions, onComplete }) {
    if (this.sessions.has(user.id)) return { ok: false, reason: "busy" };
    if (!questions?.length) return { ok: false, reason: "noQuestions" };

    const session = {
      user,
      guildId: guild.id,
      guildName: guild.name,
      questions,
      index: 0,
      answers: {},
      imageUrl: null,
      onComplete,
      startedAt: Date.now()
    };

    // نتأكد أن الخاص مفتوح قبل تسجيل الجلسة، وإلا نُبلغ العضو في المكان الذي ضغط منه
    try {
      await user.send({
        embeds: [
          buildEmbed({
            title,
            description:
              `${intro || ""}\n\nسأطرح عليك بعض الأسئلة، أجب على كل سؤال برسالة منفصلة في هذا الخاص.\n` +
              `اكتب \`إلغاء\` في أي وقت للخروج.`,
            color: this.app.config.color("primary")
          })
        ]
      });
    } catch {
      return { ok: false, reason: "dmClosed" };
    }

    this.sessions.set(user.id, session);
    await this._ask(session);
    return { ok: true };
  }

  async _ask(session) {
    const q = session.questions[session.index];
    const position = `**سؤال ${session.index + 1}/${session.questions.length}** — `;
    const hint = q.image ? "\n*(أرفق صورة مع رسالتك)*" : "";
    await session.user.send({ content: `${position}${q.label}${hint}` }).catch(() => {});
  }

  /**
   * يُستدعى من messageCreate عند وصول رسالة خاصة.
   * @returns {boolean} true إذا استُهلكت الرسالة كإجابة
   */
  async handleMessage(message) {
    const session = this.sessions.get(message.author.id);
    if (!session) return false;

    const content = (message.content || "").trim();

    if (["إلغاء", "الغاء", "cancel"].includes(content.toLowerCase())) {
      this.sessions.delete(message.author.id);
      await message.reply({ content: `${this.app.config.emoji("success")} تم إلغاء النموذج.` }).catch(() => {});
      return true;
    }

    const question = session.questions[session.index];
    const attachment = message.attachments?.first();

    if (question.image) {
      if (!attachment || !/^image\//i.test(attachment.contentType || "")) {
        await message.reply({ content: `${this.app.config.emoji("warning")} أرفق صورة مع رسالتك من فضلك.` }).catch(() => {});
        return true;
      }
      session.imageUrl = attachment.url;
      session.answers[question.label] = "(صورة مرفقة)";
    } else {
      if (!content) {
        await message.reply({ content: `${this.app.config.emoji("warning")} اكتب إجابتك نصًا من فضلك.` }).catch(() => {});
        return true;
      }
      if (question.numeric && !/^\d+$/.test(content)) {
        await message.reply({ content: `${this.app.config.emoji("warning")} أرقام فقط من فضلك.` }).catch(() => {});
        return true;
      }
      session.answers[question.label] = truncate(content, 1000);
      // الصورة تُقبل مع أي سؤال حتى لو لم تُطلب صراحة
      if (!session.imageUrl && attachment && /^image\//i.test(attachment.contentType || "")) {
        session.imageUrl = attachment.url;
      }
    }

    session.index++;

    if (session.index < session.questions.length) {
      await this._ask(session);
      return true;
    }

    this.sessions.delete(message.author.id);
    try {
      await session.onComplete({
        user: session.user,
        guildId: session.guildId,
        answers: session.answers,
        imageUrl: session.imageUrl,
        message
      });
    } catch (error) {
      this.app.errors.capture(error, { system: "applications/dmFlow", userId: message.author.id, guildId: session.guildId });
      await message.reply({
        content: `${this.app.config.emoji("error")} صار خطأ أثناء إرسال طلبك. حاول مرة ثانية.`
      }).catch(() => {});
    }
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = DMFlowService;
