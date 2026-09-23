const { buildEmbed, timestamp } = require("../../core/utils/helpers");

const STATUS_LABELS = { open: "🟢 مفتوحة", closed: "🔴 مغلقة", departed: "✈️ أقلعت", cancelled: "⚪ ملغاة" };

/**
 * نظام الرحلات والحجز.
 * الحجز يحجز المقعد أولًا (ذرّيًا)، ثم يُخصم الثمن.
 * لو فشل الخصم يُلغى الحجز فورًا، فلا يبقى مقعد محجوز بلا دفع.
 */
class FlightService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "flights") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  async book({ guild, member, flight }) {
    if (flight.status !== "open") return { ok: false, reason: "closed" };
    if (this.app.flights.booking(flight.id, member.id)) return { ok: false, reason: "already" };

    // حجز المقعد ذرّيًا قبل أي شيء، فلا يُباع نفس المقعد مرتين
    const seat = this.app.flights.book({ flightId: flight.id, userId: member.id });
    if (!seat.ok) return { ok: false, reason: seat.reason };

    if (flight.price > 0) {
      const charge = this.app.economyService.charge(guild.id, member.id, flight.price, {
        reason: `رسوم ركوب الطائرة — رحلة ${flight.code}`,
        refType: "flight",
        refId: flight.id
      });

      if (!charge.ok) {
        // التراجع عن الحجز حتى لا يُحتجز المقعد بلا دفع
        this.app.flights.cancelBooking({ flightId: flight.id, userId: member.id });
        const account = this.app.economyService.account(guild.id, member.id);
        return { ok: false, reason: "insufficient", account, needed: flight.price };
      }

      this.app.flights.markPaid(flight.id, member.id);
      await this._notifyCharge(guild, member, flight);
    }

    await this._log(guild, flight, "حجز تذكرة", member.id, { seatNo: seat.seatNo });
    return { ok: true, seatNo: seat.seatNo, flight: this.app.flights.getById(flight.id) };
  }

  /** إلغاء الحجز مع استرجاع المبلغ إن كان مدفوعًا والرحلة لم تُغلق. */
  async cancelBooking({ guild, member, flight, refund = true }) {
    const booking = this.app.flights.booking(flight.id, member.id);
    if (!booking) return { ok: false, reason: "notBooked" };

    const result = this.app.flights.cancelBooking({ flightId: flight.id, userId: member.id });
    if (!result.ok) return { ok: false, reason: result.reason };

    let refunded = 0;
    if (refund && booking.paid && flight.price > 0 && flight.status === "open") {
      this.app.economyService.add(guild.id, member.id, flight.price, {
        reason: `استرجاع تذكرة رحلة ${flight.code}`
      });
      refunded = flight.price;
    }

    await this._log(guild, flight, "إلغاء حجز", member.id, { refunded });
    return { ok: true, refunded };
  }

  async _notifyCharge(guild, member, flight) {
    const user = member.user || member;
    if (typeof user.send !== "function") return;
    await user.send({
      embeds: [
        buildEmbed({
          title: "🏦 إشعار خصم",
          description: `تم خصم مبلغ **${this.app.economyService.format(guild.id, flight.price)}** كرسوم لركوب الطائرة في مطار **${guild.name}**.`,
          color: this.app.config.color("info"),
          fields: [
            { name: "الرحلة", value: `\`${flight.code}\``, inline: true },
            { name: "الوجهة", value: flight.destination, inline: true }
          ],
          footer: "نتمنى لك رحلة ممتعة وآمنة"
        })
      ]
    }).catch(() => {});
  }

  async _log(guild, flight, title, actorId, extra = {}) {
    const channelId = this.app.guildConfig.value(guild.id, "logs.flights");
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const fields = [
      { name: "الرحلة", value: `\`${flight.code}\``, inline: true },
      { name: "الوجهة", value: flight.destination, inline: true },
      { name: "العضو", value: `<@${actorId}>`, inline: true }
    ];
    if (extra.seatNo) fields.push({ name: "المقعد", value: `#${extra.seatNo}`, inline: true });
    if (extra.refunded) {
      fields.push({ name: "المسترجع", value: this.app.economyService.format(guild.id, extra.refunded), inline: true });
    }

    await channel.send({
      embeds: [buildEmbed({ title: `✈️ ${title}`, color: this.app.config.color("info"), fields })]
    }).catch(() => {});
  }

  flightEmbed(guild, flight) {
    const fields = [
      { name: "الوجهة", value: flight.destination, inline: true },
      { name: "السعر", value: flight.price ? this.app.economyService.format(guild.id, flight.price) : "مجانية", inline: true },
      { name: "المقاعد", value: `\`${flight.seats_taken}/${flight.seats}\``, inline: true },
      { name: "الحالة", value: STATUS_LABELS[flight.status] || flight.status, inline: true }
    ];
    if (flight.captain_id) fields.push({ name: "الكابتن", value: `<@${flight.captain_id}>`, inline: true });
    if (flight.departure_at) fields.push({ name: "الإقلاع", value: timestamp(flight.departure_at, "F"), inline: true });

    return buildEmbed({
      title: `✈️ رحلة ${flight.code}`,
      color: this.app.config.color(flight.status === "open" ? "success" : "neutral"),
      fields
    });
  }

  listEmbed(guild, flights) {
    if (!flights.length) {
      return buildEmbed({ description: "لا توجد رحلات مفتوحة حاليًا.", color: this.app.config.color("neutral") });
    }
    const lines = flights.map((f) => {
      const price = f.price ? this.app.economyService.format(guild.id, f.price) : "مجانية";
      const when = f.departure_at ? ` • ${timestamp(f.departure_at, "R")}` : "";
      return `\`${f.code}\` → **${f.destination}** • ${price} • \`${f.seats_taken}/${f.seats}\` مقعد${when}`;
    });
    return buildEmbed({
      title: "✈️ الرحلات المتاحة",
      description: lines.join("\n"),
      color: this.app.config.color("primary"),
      footer: "احجز بالضغط على زر الحجز أو بأمر /flight book"
    });
  }

  passengersEmbed(guild, flight, rows) {
    if (!rows.length) {
      return buildEmbed({ description: "لا يوجد ركاب في هذه الرحلة بعد.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: `🎫 ركاب رحلة ${flight.code}`,
      description: rows.map((b) => `\`#${b.seat_no}\` <@${b.user_id}> ${b.paid ? "✅" : "⏳"}`).join("\n"),
      color: this.app.config.color("primary"),
      footer: `${rows.length} راكب من ${flight.seats} مقعد`
    });
  }
}

module.exports = FlightService;
module.exports.STATUS_LABELS = STATUS_LABELS;
