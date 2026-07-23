/**
 * Quiet hours como funções puras, sem DI.
 *
 * Extraído de `AutoReengageService` (que agora delega para cá) porque a
 * retomada manual da cadência precisa da mesma regra e o módulo `cadences`
 * conversa com `scheduling` por `forwardRef` — injetar mais um provider
 * através desse ciclo é justamente o que grava `undefined` em
 * `design:paramtypes` e derruba o boot. Import de função é aresta de leaf:
 * este arquivo não importa nada de módulo nenhum.
 */

/** Hora/min/seg de relógio (0-23) do instante `date` no fuso `timeZone`. */
export function wallClock(
  date: Date,
  timeZone: string,
): { hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  // Intl pode emitir "24" para meia-noite com hour12:false; normaliza pra 0.
  const hour = get('hour') % 24;
  return { hour, minute: get('minute'), second: get('second') };
}

/**
 * Se estamos dentro do quiet window (resolvido no fuso `timeZone`), empurra
 * para o próximo `endHour` naquele fuso; senão agora. Função pura (tz e now
 * injetados) para ficar testável.
 */
export function nextAllowedTime(
  now: Date,
  startHour: number | null,
  endHour: number | null,
  timeZone: string,
): Date {
  if (startHour === null || endHour === null) return now;
  const { hour, minute, second } = wallClock(now, timeZone);
  const inQuiet =
    startHour <= endHour
      ? hour >= startHour && hour < endHour
      : hour >= startHour || hour < endHour;
  if (!inQuiet) return now;
  // Distância (em horas de relógio no fuso) até o próximo `endHour`.
  const deltaHours = (endHour - hour + 24) % 24;
  const msUntilEnd =
    deltaHours * 3_600_000 - minute * 60_000 - second * 1000 - now.getMilliseconds();
  return new Date(now.getTime() + msUntilEnd);
}
