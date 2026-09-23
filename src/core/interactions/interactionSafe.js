/**
 * أدوات أمان التفاعلات.
 *
 * ديسكورد يرمي استثناءات شائعة يصعب التنبؤ بها:
 *   - InteractionAlreadyReplied: ضغطتان سريعتان على نفس الزر
 *   - InteractionNotReplied: محاولة editReply قبل التأكيد
 *   - Unknown interaction (10062): مرّت 3 ثوانٍ بلا رد
 *   - Unknown message (10008): حُذفت الرسالة أثناء المعالجة
 *
 * هذه الأدوات تجعل كل هذه الحالات تفشل بصمت بدل إسقاط المعالج،
 * فيبقى البوت حيًّا ولا يرى المستخدم "This interaction failed".
 *
 * (الفكرة مقتبسة من نمط interactionSafe في مشروع مرجعي، وأُعيدت
 *  كتابتها لتناسب معمارية هذا المشروع وتغطي حالات أكثر.)
 */

/** أخطاء ديسكورد التي تعني "فات الأوان" — لا فائدة من إعادة المحاولة. */
const STALE_CODES = new Set([10062, 10008, 40060]);

function isStale(error) {
  return STALE_CODES.has(error?.code);
}

/**
 * تأكيد آمن لتفاعل مكوّن (زر/قائمة) مع محاولة ثانية لأخطاء الشبكة العابرة.
 * @returns {Promise<boolean>} true إن أصبح التفاعل مؤكدًا
 */
async function ackComponent(interaction) {
  if (!interaction) return false;
  if (interaction.replied || interaction.deferred) return true;

  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    // تفاعل منتهٍ: لا جدوى من المحاولة مرة أخرى
    if (isStale(error)) return false;

    await new Promise((r) => setTimeout(r, 300));
    if (interaction.replied || interaction.deferred) return true;
    try {
      await interaction.deferUpdate();
      return true;
    } catch {
      return !!(interaction.replied || interaction.deferred);
    }
  }
}

/**
 * رد آمن: يختار reply أو followUp حسب حالة التفاعل، ولا يرمي أبدًا.
 * يحل InteractionAlreadyReplied و InteractionNotReplied معًا.
 */
async function safeReply(interaction, payload) {
  if (!interaction) return null;
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.followUp(payload);
    }
    return await interaction.reply(payload);
  } catch (error) {
    if (isStale(error)) return null;
    // آخر محاولة بالمسار المعاكس — أحيانًا تتغيّر الحالة بين الفحص والتنفيذ
    try {
      return interaction.deferred || interaction.replied
        ? await interaction.reply(payload)
        : await interaction.followUp(payload);
    } catch {
      return null;
    }
  }
}

/**
 * تحديث آمن لرسالة التفاعل.
 * لو كان التفاعل مؤكدًا مسبقًا يستخدم editReply، وإلا update.
 * يُستخدم في اللوحة حيث يتنقّل المستخدم بين عشرات الشاشات على نفس الرسالة.
 */
async function safeUpdate(interaction, payload) {
  if (!interaction) return null;
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    }
    return await interaction.update(payload);
  } catch (error) {
    if (isStale(error)) return null;
    try {
      return interaction.deferred || interaction.replied
        ? await interaction.update(payload)
        : await interaction.editReply(payload);
    } catch {
      // آخر ملاذ: رسالة مخفية حتى لا يبقى الزر صامتًا أمام المستخدم
      return safeReply(interaction, {
        content: "تعذّر تحديث الشاشة — أعد فتح اللوحة من جديد.",
        flags: 64
      });
    }
  }
}

/** عرض نافذة إدخال بأمان. النوافذ لا تُعرض على تفاعل مؤكد مسبقًا. */
async function safeModal(interaction, modal) {
  if (!interaction || interaction.replied || interaction.deferred) return false;
  try {
    await interaction.showModal(modal);
    return true;
  } catch {
    return false;
  }
}

module.exports = { ackComponent, safeReply, safeUpdate, safeModal, isStale };
