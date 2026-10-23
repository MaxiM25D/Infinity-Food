import type { ReportDimension } from "@infinityshop/database";

import { database } from "../database.js";

type AggregateDimension = {
  dimension: ReportDimension;
  key: string;
  label: string;
};

function localParts(
  date: Date,
  timezone: string,
): { date: Date; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`),
    hour: Number(parts.hour),
  };
}

function hourBand(hour: number): { key: string; label: string } {
  if (hour >= 6 && hour < 12) return { key: "MORNING", label: "06–12" };
  if (hour >= 12 && hour < 17) return { key: "MIDDAY", label: "12–17" };
  if (hour >= 17 && hour < 21) return { key: "EVENING", label: "17–21" };
  return { key: "NIGHT", label: "21–06" };
}

export async function processReportAggregates(
  batchSize = 250,
  tenantId?: string,
): Promise<{ processed: number; remaining: number }> {
  const pending = await database.orderPayment.findMany({
    where: { tenantId, reportFact: { is: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    include: {
      branch: { select: { name: true, timezone: true } },
      order: { select: { channel: true, diningSource: true } },
    },
  });
  let processed = 0;
  for (const payment of pending) {
    const local = localParts(payment.createdAt, payment.branch.timezone);
    const band = hourBand(local.hour);
    const channel = payment.order.diningSource ?? payment.order.channel;
    const dimensions: AggregateDimension[] = [
      {
        dimension: "BRANCH",
        key: payment.branchId,
        label: payment.branch.name,
      },
      { dimension: "CHANNEL", key: channel, label: channel },
      {
        dimension: "PAYMENT_METHOD",
        key: payment.method,
        label: payment.method,
      },
      { dimension: "HOUR_BAND", key: band.key, label: band.label },
    ];
    try {
      await database.$transaction(async (transaction) => {
        await transaction.reportPaymentFact.create({
          data: {
            paymentId: payment.id,
            tenantId: payment.tenantId,
            branchId: payment.branchId,
            localDate: local.date,
          },
        });
        for (const item of dimensions) {
          const key = {
            tenantId: payment.tenantId,
            branchId: payment.branchId,
            localDate: local.date,
            dimension: item.dimension,
            dimensionKey: item.key,
          };
          await transaction.reportSalesAggregate.upsert({
            where: { tenantId_branchId_localDate_dimension_dimensionKey: key },
            create: {
              ...key,
              dimensionLabel: item.label,
              grossInCents:
                payment.kind === "PAYMENT" ? payment.amountInCents : 0,
              refundsInCents:
                payment.kind === "REFUND" ? payment.amountInCents : 0,
              payments: 1,
            },
            update: {
              dimensionLabel: item.label,
              grossInCents: {
                increment:
                  payment.kind === "PAYMENT" ? payment.amountInCents : 0,
              },
              refundsInCents: {
                increment:
                  payment.kind === "REFUND" ? payment.amountInCents : 0,
              },
              payments: { increment: 1 },
            },
          });
        }
      });
      processed += 1;
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  const remaining = await database.orderPayment.count({
    where: { tenantId, reportFact: { is: null } },
  });
  return { processed, remaining };
}

export async function aggregatedSalesReport(input: {
  tenantId: string;
  branchIds: string[];
  from: string;
  to: string;
}) {
  const rows = await database.reportSalesAggregate.findMany({
    where: {
      tenantId: input.tenantId,
      branchId: { in: input.branchIds },
      localDate: {
        gte: new Date(`${input.from}T00:00:00.000Z`),
        lte: new Date(`${input.to}T00:00:00.000Z`),
      },
    },
    orderBy: [
      { localDate: "asc" },
      { dimension: "asc" },
      { dimensionKey: "asc" },
    ],
  });
  const summarize = (dimension: ReportDimension) => {
    const grouped = new Map<
      string,
      {
        key: string;
        label: string;
        grossInCents: number;
        refundsInCents: number;
        netInCents: number;
        payments: number;
      }
    >();
    for (const row of rows.filter((item) => item.dimension === dimension)) {
      const current = grouped.get(row.dimensionKey) ?? {
        key: row.dimensionKey,
        label: row.dimensionLabel,
        grossInCents: 0,
        refundsInCents: 0,
        netInCents: 0,
        payments: 0,
      };
      current.grossInCents += row.grossInCents;
      current.refundsInCents += row.refundsInCents;
      current.netInCents = current.grossInCents - current.refundsInCents;
      current.payments += row.payments;
      grouped.set(row.dimensionKey, current);
    }
    return [...grouped.values()];
  };
  return {
    range: { from: input.from, to: input.to },
    sales: {
      byBranch: summarize("BRANCH"),
      byChannel: summarize("CHANNEL"),
      byPaymentMethod: summarize("PAYMENT_METHOD"),
      byHourBand: summarize("HOUR_BAND"),
    },
    processedPayments: await database.reportPaymentFact.count({
      where: {
        tenantId: input.tenantId,
        branchId: { in: input.branchIds },
        localDate: {
          gte: new Date(`${input.from}T00:00:00.000Z`),
          lte: new Date(`${input.to}T00:00:00.000Z`),
        },
      },
    }),
  };
}
