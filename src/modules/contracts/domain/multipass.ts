import {
  MULTIPASS_DAYS_BEFORE_DEFAULT,
  MULTIPASS_DAYS_BEFORE_DISNEY_GUEST,
  MULTIPASS_REMINDER_WINDOW_DAYS,
} from '../contracts.constants';

const DAY_MS = 86_400_000;
const toMs = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function multipassBuyDate(firstDate: string, disneyGuest: boolean): string {
  const days = disneyGuest ? MULTIPASS_DAYS_BEFORE_DISNEY_GUEST : MULTIPASS_DAYS_BEFORE_DEFAULT;
  return toIso(toMs(firstDate) - days * DAY_MS);
}

export interface ReminderInput {
  id: string;
  fullName: string;
  phone: string;
  guideName: string;
  disneyGuest: boolean;
  purchased: boolean;
  dates: string[]; // YYYY-MM-DD
}

export interface MultipassReminder extends ReminderInput {
  firstDate: string;
  buyDate: string;
  daysUntilBuy: number;
}

/** Mesma regra do calendário do Lovable: compra nos próximos 14 dias, viagem ainda por vir. */
export function multipassReminders(items: ReminderInput[], today: string): MultipassReminder[] {
  const todayMs = toMs(today);
  return items
    .filter((c) => !c.purchased && c.dates.length > 0)
    .map((c) => {
      const firstDate = [...c.dates].sort()[0];
      const buyDate = multipassBuyDate(firstDate, c.disneyGuest);
      return { ...c, firstDate, buyDate, daysUntilBuy: Math.round((toMs(buyDate) - todayMs) / DAY_MS) };
    })
    .filter((r) => toMs(r.firstDate) > todayMs && r.daysUntilBuy < MULTIPASS_REMINDER_WINDOW_DAYS)
    .sort((a, b) => a.buyDate.localeCompare(b.buyDate));
}
