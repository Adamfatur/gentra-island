import { describe, expect, it } from "vitest";
import { findTime, quickTimes } from "./timeparse";

// Thursday 22 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 22, 10, 0);
const at = (text: string) => {
  const d = findTime(text, NOW);
  return d ? `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : null;
};

describe("findTime: Indonesian", () => {
  it("reads a weekday with jam and a dotted time", () => {
    expect(at("rapat Jumat jam 14.00 di ruang 3")).toBe("23/10 14:00");
  });

  it("reads besok and lusa", () => {
    expect(at("besok jam 9 pagi kirim laporan")).toBe("23/10 09:00");
    expect(at("lusa pukul 13.30")).toBe("24/10 13:30");
  });

  it("turns sore, siang, and malam into afternoon and evening hours", () => {
    expect(at("jam 3 sore")).toBe("22/10 15:00");
    expect(at("jam 1 siang")).toBe("22/10 13:00");
    expect(at("jam 8 malam")).toBe("22/10 20:00");
  });

  it("reads a date with a month name", () => {
    expect(at("deadline 28 Oktober jam 17.00")).toBe("28/10 17:00");
    expect(at("tgl 3 nov pukul 08:15")).toBe("3/11 08:15");
  });

  it("reads nanti malam as this evening", () => {
    expect(at("telpon ibu nanti malam")).toBe("22/10 20:00");
  });

  it("needs hari before minggu, which also means week", () => {
    expect(at("minggu depan jam 10.00")).toBe("23/10 10:00");
    expect(at("hari Minggu jam 10.00")).toBe("25/10 10:00");
  });
});

describe("findTime: English", () => {
  it("reads am and pm", () => {
    expect(at("meeting moved to 3 pm")).toBe("22/10 15:00");
    expect(at("call at 11:30am")).toBe("22/10 11:30");
  });

  it("reads weekdays, tomorrow, and tonight", () => {
    expect(at("Friday at 2:15 pm, same link")).toBe("23/10 14:15");
    expect(at("tomorrow 09:00 standup")).toBe("23/10 09:00");
    expect(at("dinner tonight")).toBe("22/10 20:00");
  });

  it("reads month names on either side of the day", () => {
    expect(at("launch on Nov 5 at 10am")).toBe("5/11 10:00");
    expect(at("due 30 October, 6 pm")).toBe("30/10 18:00");
  });

  it("moves a time that already passed today to tomorrow", () => {
    expect(at("standup 9:30")).toBe("23/10 09:30");
  });

  it("moves a weekday that is today but already past to next week", () => {
    expect(at("Thursday 8 am")).toBe("29/10 08:00");
  });
});

describe("findTime: things that are not times", () => {
  it("ignores prices, versions, and plain numbers", () => {
    expect(at("harga Rp 14.000 per bulan")).toBeNull();
    expect(at("upgrade to 14.00 version")).toBeNull();
    expect(at("order 1234 shipped")).toBeNull();
  });

  it("ignores timestamps in logs and ISO dates", () => {
    expect(at("2026-10-22T14:30:00Z error")).toBeNull();
    expect(at("[12:34:56] build finished")).toBeNull();
  });

  it("ignores a weekday without a time", () => {
    expect(at("see you Friday")).toBeNull();
  });

  it("ignores impossible times", () => {
    expect(at("jam 25.00")).toBeNull();
    expect(at("13 pm")).toBeNull();
  });
});

describe("quickTimes", () => {
  it("offers in an hour, tonight, and tomorrow morning", () => {
    const q = quickTimes(NOW);
    expect(q.map((x) => x.id)).toEqual(["hour", "tonight", "morning"]);
    expect(q[0].at.getHours()).toBe(11);
    expect(q[1].at.getHours()).toBe(20);
    expect(q[2].at.getDate()).toBe(23);
    expect(q[2].at.getHours()).toBe(9);
  });

  it("drops tonight once the evening has started", () => {
    expect(quickTimes(new Date(2026, 9, 22, 19, 30)).map((x) => x.id)).toEqual(["hour", "morning"]);
  });
});
