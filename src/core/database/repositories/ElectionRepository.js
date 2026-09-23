/**
 * الانتخابات بمرشحين.
 *
 * دورة الحياة: registration (تسجيل مرشحين) → voting (تصويت) → closed.
 * الصوت الأحادي يستبدل الاختيار السابق داخل معاملة واحدة، بنفس منطق poll_votes
 * لكن بمفتاح مركّب (election_id, voter_id, candidate_id) يسمح بتصويت متعدد
 * اختياري (multiple_votes) دون تغيير بنية الجدول.
 */
class ElectionRepository {
  constructor(db) {
    this.db = db;
  }

  create(data) {
    const info = this.db
      .prepare(
        `INSERT INTO elections (guild_id, title, description, multiple_votes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(data.guildId, data.title, data.description || null, data.multipleVotes ? 1 : 0, data.createdBy, Date.now());
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM elections WHERE id = ?").get(id) || null;
  }

  getByMessage(messageId) {
    return this.db.prepare("SELECT * FROM elections WHERE message_id = ?").get(messageId) || null;
  }

  setMessage(id, channelId, messageId) {
    this.db.prepare("UPDATE elections SET channel_id = ?, message_id = ? WHERE id = ?").run(channelId, messageId, id);
  }

  listActive(guildId) {
    return this.db
      .prepare("SELECT * FROM elections WHERE guild_id = ? AND status != 'closed' ORDER BY created_at DESC")
      .all(guildId);
  }

  listAll(guildId, limit = 15) {
    return this.db.prepare("SELECT * FROM elections WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId, limit);
  }

  /** يفتح التصويت ويقفل التسجيل. لا يعمل إلا من حالة registration. */
  startVoting(id) {
    return this.db
      .prepare("UPDATE elections SET status = 'voting', registration_open = 0, voting_open = 1 WHERE id = ? AND status = 'registration'")
      .run(id).changes === 1;
  }

  /** يقفل الانتخاب نهائيًا. ذرّي، لا يمكن إغلاقه مرتين. */
  close(id) {
    return this.db
      .prepare("UPDATE elections SET status = 'closed', voting_open = 0, closed_at = ? WHERE id = ? AND status != 'closed'")
      .run(Date.now(), id).changes === 1;
  }

  // ---------------- المرشحون ----------------

  registerCandidate(data) {
    const info = this.db
      .prepare(
        `INSERT INTO candidates (election_id, user_id, platform, image_url, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .run(data.electionId, data.userId, data.platform, data.imageUrl || null, Date.now());
    return this.getCandidate(info.lastInsertRowid);
  }

  getCandidate(id) {
    return this.db.prepare("SELECT * FROM candidates WHERE id = ?").get(id) || null;
  }

  getCandidacy(electionId, userId) {
    return this.db.prepare("SELECT * FROM candidates WHERE election_id = ? AND user_id = ?").get(electionId, userId) || null;
  }

  listCandidates(electionId, { approvedOnly = false } = {}) {
    // نرتّب بـ id لا created_at لنفس سبب social_posts وapplication_types:
    // تسجيل عدة مرشحين بسرعة قد يقع ضمن نفس المللي ثانية.
    const sql = approvedOnly
      ? "SELECT * FROM candidates WHERE election_id = ? AND status = 'approved' ORDER BY id ASC"
      : "SELECT * FROM candidates WHERE election_id = ? ORDER BY id ASC";
    return this.db.prepare(sql).all(electionId);
  }

  /** قرار ذرّي: مرة واحدة فقط، فلا يُقبل ويُرفض نفس المرشح معًا. */
  decideCandidate(id, status, reviewerId, note) {
    return this.db
      .prepare("UPDATE candidates SET status = ?, reviewer_id = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'pending'")
      .run(status, reviewerId, Date.now(), note || null, id).changes === 1;
  }

  // ---------------- الأصوات ----------------

  hasVoted(electionId, voterId) {
    return !!this.db.prepare("SELECT 1 FROM election_votes WHERE election_id = ? AND voter_id = ?").get(electionId, voterId);
  }

  votedFor(electionId, voterId) {
    return this.db.prepare("SELECT candidate_id FROM election_votes WHERE election_id = ? AND voter_id = ?").all(electionId, voterId).map((r) => r.candidate_id);
  }

  /**
   * تصويت أحادي: يمنع التصويت المزدوج ذرّيًا عبر شرط عدم الوجود المسبق
   * داخل نفس المعاملة، لا بفحص منفصل قابل لحالة سباق.
   */
  voteSingle({ electionId, candidateId, voterId }) {
    const apply = this.db.transaction(() => {
      const existing = this.db.prepare("SELECT 1 FROM election_votes WHERE election_id = ? AND voter_id = ?").get(electionId, voterId);
      if (existing) return { ok: false, reason: "alreadyVoted" };
      this.db
        .prepare("INSERT INTO election_votes (election_id, candidate_id, voter_id, voted_at) VALUES (?, ?, ?, ?)")
        .run(electionId, candidateId, voterId, Date.now());
      return { ok: true };
    });
    return apply();
  }

  /** تصويت متعدد: يمنع تصويت العضو لنفس المرشح مرتين، عبر المفتاح المركّب نفسه. */
  voteMultiple({ electionId, candidateId, voterId }) {
    const res = this.db
      .prepare("INSERT OR IGNORE INTO election_votes (election_id, candidate_id, voter_id, voted_at) VALUES (?, ?, ?, ?)")
      .run(electionId, candidateId, voterId, Date.now());
    return { ok: res.changes === 1 };
  }

  results(electionId) {
    const rows = this.db
      .prepare(
        `SELECT c.id AS candidate_id, c.user_id, COUNT(v.voter_id) AS votes
         FROM candidates c LEFT JOIN election_votes v ON v.candidate_id = c.id
         WHERE c.election_id = ? AND c.status = 'approved'
         GROUP BY c.id ORDER BY votes DESC, c.created_at ASC`
      )
      .all(electionId);
    return rows;
  }

  totalVoters(electionId) {
    return this.db.prepare("SELECT COUNT(DISTINCT voter_id) AS c FROM election_votes WHERE election_id = ?").get(electionId).c;
  }
}

module.exports = ElectionRepository;
