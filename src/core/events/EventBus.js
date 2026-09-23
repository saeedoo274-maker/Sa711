const { EventEmitter } = require("events");

/** أسماء الأحداث الداخلية. الأنظمة تتواصل عبرها بدل استدعاء بعضها مباشرة. */
const Events = {
  MEMBER_BANNED: "member:banned",
  MEMBER_UNBANNED: "member:unbanned",
  MEMBER_KICKED: "member:kicked",
  MEMBER_TIMEOUT: "member:timeout",
  MEMBER_UNTIMEOUT: "member:untimeout",
  MEMBER_WARNED: "member:warned",
  WARN_REMOVED: "member:warnRemoved",
  ROLE_ADDED: "role:added",
  ROLE_REMOVED: "role:removed",
  NICKNAME_CHANGED: "member:nickname",
  MESSAGES_CLEARED: "channel:cleared",
  CHANNEL_LOCKED: "channel:locked",
  CHANNEL_UNLOCKED: "channel:unlocked",
  SLOWMODE_SET: "channel:slowmode",
  VOICE_ACTION: "voice:action",
  CASE_CREATED: "case:created",
  STAFF_PROMOTED: "staff:promoted",
  STAFF_DEMOTED: "staff:demoted",
  SECURITY_TRIGGERED: "security:triggered",
  ERROR_CAPTURED: "system:error"
};

/**
 * ناقل أحداث لا يسمح لأي مستمع فاشل بإسقاط البوت،
 * ولا بإيقاف بقية المستمعين على نفس الحدث.
 */
class EventBus extends EventEmitter {
  constructor(logger) {
    super();
    this.setMaxListeners(50);
    this.logger = logger;
  }

  emitSafe(event, payload) {
    const listeners = this.listeners(event);
    for (const listener of listeners) {
      try {
        const result = listener(payload);
        if (result && typeof result.catch === "function") {
          result.catch((err) => this.logger.error(`فشل مستمع الحدث ${event}: ${err.message}`));
        }
      } catch (err) {
        this.logger.error(`فشل مستمع الحدث ${event}: ${err.message}`);
      }
    }
  }
}

module.exports = { EventBus, Events };
