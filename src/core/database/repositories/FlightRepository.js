class FlightRepository {
  constructor(db) {
    this.db = db;

    /**
     * الحجز ذرّي بضمانين معًا:
     *  1) المفتاح الأساسي (flight_id, user_id) يمنع الحجز المزدوج لنفس الشخص.
     *  2) شرط `seats_taken < seats` داخل UPDATE يمنع تجاوز سعة الطائرة
     *     حتى لو ضغط عشرة أشخاص على آخر مقعد في نفس اللحظة.
     */
    this._book = db.transaction(({ flightId, userId }) => {
      const seat = db
        .prepare("UPDATE flights SET seats_taken = seats_taken + 1 WHERE id = ? AND status = 'open' AND seats_taken < seats")
        .run(flightId);
      if (seat.changes !== 1) return { ok: false, reason: "full" };

      const flight = db.prepare("SELECT * FROM flights WHERE id = ?").get(flightId);
      const insert = db
        .prepare("INSERT OR IGNORE INTO flight_bookings (flight_id, user_id, seat_no, paid, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(flightId, userId, flight.seats_taken, Date.now());

      if (insert.changes !== 1) {
        // العضو محجوز أصلًا — نتراجع عن زيادة العدّاد
        db.prepare("UPDATE flights SET seats_taken = seats_taken - 1 WHERE id = ?").run(flightId);
        return { ok: false, reason: "already" };
      }

      return { ok: true, seatNo: flight.seats_taken, flight };
    });

    this._cancel = db.transaction(({ flightId, userId }) => {
      const res = db.prepare("DELETE FROM flight_bookings WHERE flight_id = ? AND user_id = ?").run(flightId, userId);
      if (res.changes !== 1) return { ok: false, reason: "notBooked" };
      db.prepare("UPDATE flights SET seats_taken = MAX(0, seats_taken - 1) WHERE id = ?").run(flightId);
      return { ok: true };
    });
  }

  create(data) {
    const info = this.db
      .prepare(
        `INSERT INTO flights (guild_id, code, destination, price, seats, seats_taken, captain_id, departure_at, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'open', ?, ?)`
      )
      .run(
        data.guildId, data.code, data.destination, data.price || 0, data.seats || 0,
        data.captainId || null, data.departureAt || null, data.createdBy || null, Date.now()
      );
    return this.getById(info.lastInsertRowid);
  }

  getById(id) {
    return this.db.prepare("SELECT * FROM flights WHERE id = ?").get(id) || null;
  }

  getByCode(guildId, code) {
    return this.db.prepare("SELECT * FROM flights WHERE guild_id = ? AND code = ?").get(guildId, code) || null;
  }

  listOpen(guildId) {
    return this.db.prepare("SELECT * FROM flights WHERE guild_id = ? AND status = 'open' ORDER BY departure_at ASC").all(guildId);
  }

  listAll(guildId, limit = 20) {
    return this.db.prepare("SELECT * FROM flights WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?").all(guildId, limit);
  }

  book(args) { return this._book(args); }
  cancelBooking(args) { return this._cancel(args); }

  markPaid(flightId, userId) {
    return this.db
      .prepare("UPDATE flight_bookings SET paid = 1 WHERE flight_id = ? AND user_id = ? AND paid = 0")
      .run(flightId, userId).changes === 1;
  }

  booking(flightId, userId) {
    return this.db.prepare("SELECT * FROM flight_bookings WHERE flight_id = ? AND user_id = ?").get(flightId, userId) || null;
  }

  passengers(flightId) {
    return this.db.prepare("SELECT * FROM flight_bookings WHERE flight_id = ? ORDER BY seat_no ASC").all(flightId);
  }

  /** إغلاق الرحلة ذرّي، فلا تُقفل مرتين. */
  close(id, status = "closed") {
    return this.db.prepare("UPDATE flights SET status = ? WHERE id = ? AND status = 'open'").run(status, id).changes === 1;
  }

  updateField(id, field, value) {
    const statements = {
      price: "UPDATE flights SET price = ? WHERE id = ?",
      seats: "UPDATE flights SET seats = ? WHERE id = ?",
      destination: "UPDATE flights SET destination = ? WHERE id = ?",
      captain_id: "UPDATE flights SET captain_id = ? WHERE id = ?",
      departure_at: "UPDATE flights SET departure_at = ? WHERE id = ?"
    };
    if (!statements[field]) throw new Error(`حقل غير مسموح: ${field}`);
    this.db.prepare(statements[field]).run(value, id);
    return this.getById(id);
  }
}

module.exports = FlightRepository;
