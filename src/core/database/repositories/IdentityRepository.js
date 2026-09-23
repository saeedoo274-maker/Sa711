/**
 * الهوية الوطنية: طلب، مراجعة، وإصدار بطاقة برقم متسلسل.
 * هوية واحدة لكل عضو في كل سيرفر (مفتاح فريد يمنع التكرار ذرّيًا).
 */
class IdentityRepository {
  constructor(db) {
    this.db = db;

    this._create = db.transaction((data) => {
      db.prepare("INSERT INTO identity_counters (guild_id, last_number) VALUES (?, 0) ON CONFLICT(guild_id) DO NOTHING").run(data.guildId);
      db.prepare("UPDATE identity_counters SET last_number = last_number + 1 WHERE guild_id = ?").run(data.guildId);
      const { last_number: number } = db.prepare("SELECT last_number FROM identity_counters WHERE guild_id = ?").get(data.guildId);

      db.prepare(
        `INSERT INTO identities
           (guild_id, user_id, card_number, full_name, birth_date, birth_place, gender, nationality, job, photo_url, created_at)
         VALUES (@guildId, @userId, @number, @fullName, @birthDate, @birthPlace, @gender, @nationality, @job, @photoUrl, @createdAt)`
      ).run({
        guildId: data.guildId,
        userId: data.userId,
        number,
        fullName: data.fullName,
        birthDate: data.birthDate || null,
        birthPlace: data.birthPlace || null,
        gender: data.gender || null,
        nationality: data.nationality || null,
        job: data.job || null,
        photoUrl: data.photoUrl || null,
        createdAt: Date.now()
      });
      return number;
    });
  }

  create(data) {
    const number = this._create(data);
    return this.getByNumber(data.guildId, number);
  }

  get(guildId, userId) {
    return this.db.prepare("SELECT * FROM identities WHERE guild_id = ? AND user_id = ?").get(guildId, userId) || null;
  }

  getByNumber(guildId, number) {
    return this.db.prepare("SELECT * FROM identities WHERE guild_id = ? AND card_number = ?").get(guildId, number) || null;
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM identities WHERE id = ?").get(id) || null;
  }

  setMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE identities SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  /** قبول الهوية ذرّيًا: ينجح مرة واحدة فقط مهما تزامن المراجعون. */
  approve(id, reviewerId, validityMs) {
    const now = Date.now();
    return this.db
      .prepare(
        `UPDATE identities SET status = 'approved', reviewer_id = ?, reviewed_at = ?, issued_at = ?, expires_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(reviewerId, now, now, validityMs ? now + validityMs : null, id).changes === 1;
  }

  reject(id, reviewerId, reason) {
    return this.db
      .prepare("UPDATE identities SET status = 'rejected', reviewer_id = ?, reviewed_at = ?, reject_reason = ? WHERE id = ? AND status = 'pending'")
      .run(reviewerId, Date.now(), reason || null, id).changes === 1;
  }

  /** حذف الهوية ليتمكن العضو من التقديم من جديد. */
  remove(guildId, userId) {
    return this.db.prepare("DELETE FROM identities WHERE guild_id = ? AND user_id = ?").run(guildId, userId).changes === 1;
  }

  /** تعديل حقل واحد. أسماء الأعمدة على قائمة بيضاء صارمة. */
  update(id, field, value) {
    const statements = {
      full_name: "UPDATE identities SET full_name = ? WHERE id = ?",
      birth_date: "UPDATE identities SET birth_date = ? WHERE id = ?",
      birth_place: "UPDATE identities SET birth_place = ? WHERE id = ?",
      gender: "UPDATE identities SET gender = ? WHERE id = ?",
      nationality: "UPDATE identities SET nationality = ? WHERE id = ?",
      job: "UPDATE identities SET job = ? WHERE id = ?",
      photo_url: "UPDATE identities SET photo_url = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, id);
    return this.getById(id);
  }

  listPending(guildId, limit = 15) {
    return this.db
      .prepare("SELECT * FROM identities WHERE guild_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ?")
      .all(guildId, limit);
  }

  search(guildId, term, limit = 10) {
    const like = `%${term}%`;
    return this.db
      .prepare(
        `SELECT * FROM identities WHERE guild_id = ? AND status = 'approved'
         AND (full_name LIKE ? OR CAST(card_number AS TEXT) LIKE ?) ORDER BY card_number ASC LIMIT ?`
      )
      .all(guildId, like, like, limit);
  }

  stats(guildId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending,
           COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END),0) AS approved,
           COALESCE(SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END),0) AS rejected
         FROM identities WHERE guild_id = ?`
      )
      .get(guildId);
  }
}

module.exports = IdentityRepository;
