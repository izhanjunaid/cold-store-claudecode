import type { Prisma, PrismaClient } from '@coldchain/db';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The unit a lot's goods are counted in, for its papers (docs/32 section 2.4): the
 * storage receipt of apples says "Crates", never a fixed "Bags".
 */
export async function lotUnit(db: Db, lotId: string): Promise<{ commodityName: string; unitLabel: string; unitLabelUrdu: string | null }> {
  const lot = await db.lot.findUnique({
    where: { id: lotId },
    select: { commodity: { select: { name: true, unitLabel: true, unitNameUrdu: true } } },
  });
  return {
    commodityName: lot?.commodity.name ?? '',
    unitLabel: lot?.commodity.unitLabel ?? 'Bags',
    unitLabelUrdu: lot?.commodity.unitNameUrdu ?? null,
  };
}
