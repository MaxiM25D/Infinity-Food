import { expect, test, type APIResponse } from "@playwright/test";

async function expectStatus(response: APIResponse, status: number) {
  expect(response.status(), await response.text()).toBe(status);
}

test("operacion gastronomica completa: QR, KDS, POS, caja y reservas", async ({ page }) => {
  page.on("pageerror", (error) => console.error("browser-page-error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("browser-console-error", message.text());
  });

  const unique = Date.now();
  const tenantSlug = `e2e-food-${unique}`;
  const branchSlug = "principal";
  const productName = `Milanesa E2E ${unique}`;

  const registration = await page.request.post("/api/auth/register", {
    data: {
      email: `e2e-food-${unique}@example.test`, password: "ClaveSegura123!",
      firstName: "E2E", lastName: "InfinityFood", storeName: "Restaurante E2E", storeSlug: tenantSlug,
    },
  });
  await expectStatus(registration, 201);

  const categoryResponse = await page.request.post("/api/admin/categories", {
    data: { name: "Principales", slug: `principales-${unique}` },
  });
  await expectStatus(categoryResponse, 201);
  const category = (await categoryResponse.json()).category as { id: string };

  const productResponse = await page.request.post("/api/admin/products", {
    data: {
      categoryId: category.id, sku: `E2E-${unique}`, slug: `milanesa-e2e-${unique}`,
      name: productName, description: "Plato operativo para el circuito E2E",
      priceInCents: 3000, stock: 100,
    },
  });
  await expectStatus(productResponse, 201);
  const product = (await productResponse.json()).product as { id: string };

  const modifiersResponse = await page.request.put(`/api/admin/advanced/menu-items/${product.id}/modifiers`, {
    data: {
      groups: [{
        name: "Extra E2E", minChoices: 1, maxChoices: 1, sortOrder: 0, active: true,
        options: [{ name: "Con cheddar", priceInCents: 200, sortOrder: 0, active: true }],
      }],
    },
  });
  await expectStatus(modifiersResponse, 200);
  const modifierOptionId = (await modifiersResponse.json()).groups[0].options[0].id as string;

  const tableResponse = await page.request.post("/api/admin/dining/tables", {
    data: { code: `M${unique}`, name: "Mesa E2E", maxCapacity: 4 },
  });
  await expectStatus(tableResponse, 201);
  const table = (await tableResponse.json()).table as { id: string; code: string };

  const stationsResponse = await page.request.get("/api/admin/dining/stations");
  await expectStatus(stationsResponse, 200);
  const stations = (await stationsResponse.json()).stations as Array<{ id: string }>;
  expect(stations).toHaveLength(1);

  await page.goto(`/mesa/${tenantSlug}/${branchSlug}/${table.code}`);
  await expect(page.getByRole("heading", { name: "Restaurante E2E" })).toBeVisible();
  await expect(page.getByText(productName)).toBeVisible();
  await page.getByRole("button", { name: `Agregar ${productName}` }).click();
  await expect(page.getByRole("button", { name: /Con cheddar/ })).toBeVisible();

  const qrRequestId = crypto.randomUUID();
  const qrOrderBody = {
    clientRequestId: qrRequestId, customerName: "Cliente QR E2E",
    items: [{ productId: product.id, quantity: 2, notes: "Sin sal", preparationPoint: "A punto", modifierOptionIds: [modifierOptionId] }],
  };
  const qrOrderResponse = await page.request.post(
    `/api/dining/${tenantSlug}/${branchSlug}/tables/${table.code}/orders`, { data: qrOrderBody },
  );
  await expectStatus(qrOrderResponse, 201);
  const qrOrder = (await qrOrderResponse.json()).order as {
    id: string; rounds: Array<{ tickets: Array<{ id: string }> }>;
  };
  expect(qrOrder.rounds).toHaveLength(1);
  expect(qrOrder.rounds[0]?.tickets).toHaveLength(1);

  const repeatedQrOrder = await page.request.post(
    `/api/dining/${tenantSlug}/${branchSlug}/tables/${table.code}/orders`, { data: qrOrderBody },
  );
  await expectStatus(repeatedQrOrder, 200);
  expect((await repeatedQrOrder.json()).created).toBe(false);

  const kdsSnapshot = await page.request.get(`/api/admin/dining/kds/${stations[0]?.id}/tickets`);
  await expectStatus(kdsSnapshot, 200);
  const tickets = (await kdsSnapshot.json()).tickets as Array<{
    id: string; items: Array<{ orderItem: { productName: string; quantity: number; preparationPoint: string | null; modifiers: Array<{ optionName: string }> } }>;
  }>;
  expect(tickets).toHaveLength(1);
  expect(tickets[0]?.items[0]?.orderItem).toMatchObject({ productName, quantity: 2, preparationPoint: "A punto", modifiers: [{ optionName: "Con cheddar" }] });

  await page.goto("/kds");
  await expect(page.getByRole("heading", { name: "InfinityFood KDS" })).toBeVisible();
  await expect(page.getByText(productName)).toBeVisible();

  const ticketEventId = crypto.randomUUID();
  const preparing = await page.request.patch(`/api/admin/dining/kds/tickets/${tickets[0]?.id}/status`, {
    data: { status: "PREPARING", eventId: ticketEventId },
  });
  await expectStatus(preparing, 200);
  const repeatedEvent = await page.request.patch(`/api/admin/dining/kds/tickets/${tickets[0]?.id}/status`, {
    data: { status: "PREPARING", eventId: ticketEventId },
  });
  await expectStatus(repeatedEvent, 200);
  expect((await repeatedEvent.json()).idempotent).toBe(true);

  const cashOpenResponse = await page.request.post("/api/admin/pos/cash-sessions/open", {
    data: { openingCashInCents: 10_000, note: "Apertura E2E" },
  });
  await expectStatus(cashOpenResponse, 201);
  const cashSession = (await cashOpenResponse.json()).session as { id: string };

  const posOrderResponse = await page.request.post("/api/admin/pos/orders", {
    data: {
      clientRequestId: crypto.randomUUID(), serviceMode: "COUNTER", customerName: "Mostrador E2E",
      items: [{ productId: product.id, quantity: 1, modifierOptionIds: [modifierOptionId] }],
    },
  });
  await expectStatus(posOrderResponse, 201);
  const posOrder = (await posOrderResponse.json()).order as { id: string; totalInCents: number; items: Array<{ id: string }> };
  expect(posOrder.totalInCents).toBe(3200);

  const tipResponse = await page.request.post(`/api/admin/advanced/orders/${posOrder.id}/adjustments`, {
    data: { clientRequestId: crypto.randomUUID(), type: "TIP", label: "Propina", reason: "Servicio E2E", amountInCents: 100 },
  });
  await expectStatus(tipResponse, 201);
  expect((await tipResponse.json()).order.totalInCents).toBe(3300);

  const cashPayment = await page.request.post(`/api/admin/pos/orders/${posOrder.id}/payments`, {
    data: { clientRequestId: crypto.randomUUID(), method: "CASH", amountInCents: 1650, allocations: [{ amountInCents: 1650, guestLabel: "Ana" }] },
  });
  await expectStatus(cashPayment, 201);
  const cardPayment = await page.request.post(`/api/admin/pos/orders/${posOrder.id}/payments`, {
    data: {
      clientRequestId: crypto.randomUUID(), method: "CARD_EXTERNAL",
      amountInCents: 1650, reference: "E2E-CARD", allocations: [{ amountInCents: 1650, orderItemId: posOrder.items[0]?.id }],
    },
  });
  await expectStatus(cardPayment, 201);
  expect((await cardPayment.json()).order.balanceInCents).toBe(0);

  const receiptResponse = await page.request.post(`/api/admin/advanced/orders/${posOrder.id}/print`, {
    data: { clientRequestId: crypto.randomUUID() },
  });
  await expectStatus(receiptResponse, 201);
  expect((await receiptResponse.json()).job.type).toBe("RECEIPT");

  const closeResponse = await page.request.post(`/api/admin/pos/cash-sessions/${cashSession.id}/close`, {
    data: { declaredCashInCents: 11_650, note: "Cierre E2E" },
  });
  await expectStatus(closeResponse, 200);
  expect((await closeResponse.json()).session).toMatchObject({
    expectedClosingCashInCents: 11_650, differenceInCents: 0, salesTotalInCents: 3300,
  });

  await page.goto("/admin?tab=pos");
  await expect(page.getByRole("heading", { name: "POS, pagos y caja" })).toBeVisible();
  await page.goto("/admin?tab=advanced");
  await expect(page.getByRole("heading", { name: "Operación gastronómica avanzada" })).toBeVisible();

  const schedulesResponse = await page.request.put("/api/admin/reservations/schedules", {
    data: {
      schedules: Array.from({ length: 7 }, (_, weekday) => ({
        weekday, opensAtMinutes: 600, closesAtMinutes: 1320, active: true,
      })),
    },
  });
  await expectStatus(schedulesResponse, 200);

  const reservationDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const holdResponse = await page.request.post(`/api/reservations/${tenantSlug}/${branchSlug}/holds`, {
    data: {
      clientRequestId: crypto.randomUUID(), date: reservationDate, time: "20:00",
      partySize: 2, durationMinutes: 90, customerName: "Reserva E2E",
      customerPhone: "+5491112345678", customerEmail: `reserva-${unique}@example.test`,
    },
  });
  await expectStatus(holdResponse, 201);
  const held = await holdResponse.json() as {
    reservation: { id: string; status: string }; manageToken: string;
  };
  expect(held.reservation.status).toBe("HOLD");

  const confirmationResponse = await page.request.post(
    `/api/reservations/${tenantSlug}/${branchSlug}/${held.reservation.id}/confirm`,
    { data: { manageToken: held.manageToken } },
  );
  await expectStatus(confirmationResponse, 200);
  expect((await confirmationResponse.json()).reservation.status).toBe("CONFIRMED");

  const reservationOverview = await page.request.get(
    `/api/admin/reservations/overview?date=${reservationDate}`,
  );
  await expectStatus(reservationOverview, 200);
  const reservations = (await reservationOverview.json()).reservations as Array<{ id: string; status: string }>;
  expect(reservations).toContainEqual(expect.objectContaining({
    id: held.reservation.id, status: "CONFIRMED",
  }));

  await page.goto(`/reservas/${tenantSlug}/${branchSlug}`);
  await expect(page.getByRole("heading", { name: "Reservá tu mesa" })).toBeVisible();
  await expect(page.getByText("Casa central")).toBeVisible();
});
