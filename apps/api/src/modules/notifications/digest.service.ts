import type { PrismaClient } from '@coldchain/db';
import { getDashboard } from '../reporting/reports/dashboard';
import { resolveFacilitySettings } from '../facility/facility.service';
import type { MailService } from '../mail/mail.service';
import { mailConfigFromSettings } from '../mail/mail.service';

const fmtPkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;
const fmtNum = (n: number) => n.toLocaleString('en-PK');

export interface DigestResult {
  sent: boolean;
  reason?: string;
  had_content: boolean;
}

/**
 * Composes and sends the daily digest email. Content is assembled from named
 * sections (receivables, storage alerts, aging lots) so new sections are
 * additive — add a builder and a template block. Sending is always non-fatal.
 */
export class DigestService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mail: MailService,
  ) {}

  private async build(facilityId: string) {
    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    if (!facility) return null;

    const settings = resolveFacilitySettings(facility.settings);
    const dashboard = await getDashboard(this.prisma, facilityId, 'OWNER');

    const warningPct = settings.chamber_capacity_warning_pct;
    const fullChambers = dashboard.chambers
      .filter((c) => c.occupancy_pct >= warningPct)
      .map((c) => ({ name: c.name, occupancy_pct: c.occupancy_pct, bags: fmtNum(c.bags), capacity: fmtNum(c.capacity) }));
    const agingLots = dashboard.attention_required.map((l) => ({
      lot_number: l.lot_number,
      owner_name: l.owner_name,
      commodity_name: l.commodity_name,
      current_bags: fmtNum(l.current_bags),
      days_in_storage: l.days_in_storage,
    }));
    const arTotal = dashboard.financial?.ar_total_pkr ?? 0;
    const overdue90 = dashboard.financial?.overdue_90_plus_pkr ?? 0;
    const unbilledCount = dashboard.unbilled_invoices?.count ?? 0;
    const unbilledTotal = dashboard.unbilled_invoices?.total_pkr ?? 0;

    const hasReceivables = arTotal > 0;
    const hasStorageAlerts = fullChambers.length > 0;
    const hasAgingLots = agingLots.length > 0;
    const hasUnbilled = unbilledCount > 0;

    return {
      config: mailConfigFromSettings(facility.settings),
      hasContent: hasReceivables || hasStorageAlerts || hasAgingLots || hasUnbilled,
      context: {
        facilityName: facility.name,
        date: new Date().toLocaleDateString('en-GB', { dateStyle: 'full' }),
        activeLots: fmtNum(dashboard.active_lots),
        totalBags: fmtNum(dashboard.total_bags),
        occupancyPct: dashboard.occupancy_pct,
        hasReceivables,
        arTotal: fmtPkr(arTotal),
        overdue90: fmtPkr(overdue90),
        hasStorageAlerts,
        fullChambers,
        warningPct,
        hasAgingLots,
        agingLots,
        hasUnbilled,
        unbilledCount,
        unbilledTotal: fmtPkr(unbilledTotal),
      },
    };
  }

  /** Build and email the digest to the facility admin. Never throws. */
  async sendNow(facilityId: string): Promise<DigestResult> {
    const built = await this.build(facilityId);
    if (!built) return { sent: false, reason: 'Facility not found', had_content: false };
    if (!built.config) {
      return { sent: false, reason: 'Email is not configured (Settings → Email).', had_content: built.hasContent };
    }
    const to = built.config.adminEmail || built.config.user;
    if (!to) return { sent: false, reason: 'No admin email is set.', had_content: built.hasContent };

    try {
      await this.mail.send(built.config, {
        to,
        subject: `ColdChain daily digest — ${built.context.facilityName}`,
        template: 'daily-digest',
        context: built.context,
      });
      return { sent: true, had_content: built.hasContent };
    } catch (e) {
      return { sent: false, reason: e instanceof Error ? e.message : 'Send failed', had_content: built.hasContent };
    }
  }
}
