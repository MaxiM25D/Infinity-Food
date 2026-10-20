import { database } from "../database.js";
import {
  billingProviderConfigured,
  getProviderSubscription,
  updateProviderSubscription,
} from "../services/saas-billing-provider.js";

async function run(): Promise<void> {
  const plan = await database.plan.findUniqueOrThrow({ where: { code: "PRO" } });
  if (!billingProviderConfigured()) {
    console.log("Suscripciones MP sin reconciliar: la facturación SaaS no está configurada");
    return;
  }

  const subscriptions = await database.subscription.findMany({
    where: {
      providerSubscriptionId: { not: null },
      providerStatus: { not: "canceled" },
      status: { not: "CANCELED" },
    },
    include: { tenant: { select: { name: true } } },
  });

  let updated = 0;
  for (const subscription of subscriptions) {
    const providerSubscription = await getProviderSubscription(subscription.providerSubscriptionId!);
    if (providerSubscription.external_reference !== subscription.tenantId) {
      throw new Error(`La suscripción MP ${providerSubscription.id} no pertenece a la tienda ${subscription.tenantId}`);
    }
    if (providerSubscription.status === "canceled") continue;

    const currentAmountInCents = Math.round((providerSubscription.auto_recurring?.transaction_amount ?? 0) * 100);
    const currentCurrency = providerSubscription.auto_recurring?.currency_id;
    const expectedReason = `InfinityFood ${plan.name} - ${subscription.tenant.name}`;
    if (
      currentAmountInCents !== plan.priceInCents
      || currentCurrency !== plan.currency
      || providerSubscription.reason !== expectedReason
    ) {
      await updateProviderSubscription(subscription.providerSubscriptionId!, {
        planName: plan.name,
        tenantName: subscription.tenant.name,
        priceInCents: plan.priceInCents,
        currency: plan.currency,
      });
      updated += 1;
    }

    await database.subscription.update({
      where: { tenantId: subscription.tenantId },
      data: { planId: plan.id, pendingPlanId: null },
    });
  }

  console.log(
    `Plan único reconciliado: ${subscriptions.length} revisada(s), ${updated} actualizada(s) en Mercado Pago a ARS ${plan.priceInCents / 100}`,
  );
}

try {
  await run();
} finally {
  await database.$disconnect();
}
