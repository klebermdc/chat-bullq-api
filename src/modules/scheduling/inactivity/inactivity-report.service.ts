import { Injectable } from '@nestjs/common';
import { InactivityRepository } from './inactivity.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class InactivityReportService {
  constructor(private readonly repo: InactivityRepository) {}

  async report(params: {
    organizationId: string;
    assignedToId?: string;
    band?: number;
    page: number;
    pageSize: number;
  }) {
    const { organizationId, assignedToId, band, page, pageSize } = params;
    const now = Date.now();
    const [byBand, list] = await Promise.all([
      this.repo.countByBand(organizationId, assignedToId),
      this.repo.listInactive({
        organizationId,
        assignedToId,
        band,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      byBand,
      items: list.map((c) => ({
        conversationId: c.id,
        band: c.inactivityBand,
        daysStale: c.lastOutboundAt
          ? Math.floor((now - c.lastOutboundAt.getTime()) / DAY_MS)
          : null,
        contact: c.contact,
        channel: c.channel,
        assignedTo: c.assignedTo,
        hasPendingSchedule: c.scheduledMessages.length > 0,
      })),
      page,
      pageSize,
    };
  }

  async csv(params: {
    organizationId: string;
    assignedToId?: string;
  }): Promise<string> {
    const { items } = await this.report({
      ...params,
      page: 1,
      pageSize: 5000,
    });
    const header =
      'conversationId,band,daysStale,contact,channel,assignedTo,hasPendingSchedule';
    const rows = items.map((i) =>
      [
        i.conversationId,
        i.band,
        i.daysStale,
        JSON.stringify(i.contact?.name ?? ''),
        JSON.stringify(i.channel?.name ?? ''),
        JSON.stringify(i.assignedTo?.name ?? ''),
        i.hasPendingSchedule,
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }
}
