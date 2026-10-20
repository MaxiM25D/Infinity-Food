import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import bcrypt from "bcryptjs";
import request from "supertest";

import { app } from "../src/app.js";
import { database } from "../src/database.js";

const ownerAgent = request.agent(app);
const staffAgent = request.agent(app);
const slug = "branches-test";
const otherSlug = "branches-other-test";
const ownerEmail = "branches-owner@example.test";
const staffEmail = "branches-staff@example.test";
const otherEmail = "branches-other@example.test";
const password = "ClaveSegura123!";
let tenantId = "";
let primaryBranchId = "";
let secondaryBranchId = "";
let staffUserId = "";

async function cleanup(): Promise<void> {
  await database.tenant.deleteMany({ where: { slug: { in: [slug, otherSlug] } } });
  await database.user.deleteMany({ where: { email: { in: [ownerEmail, staffEmail, otherEmail] } } });
}

before(async () => {
  await cleanup();
  const registration = await ownerAgent.post("/api/auth/register").send({
    email: ownerEmail,
    password,
    firstName: "Dueña",
    lastName: "Sucursal",
    storeName: "Restaurante Sucursales",
    storeSlug: slug,
  });
  assert.equal(registration.status, 201);
  const tenant = await database.tenant.findUniqueOrThrow({ where: { slug }, include: { branches: true } });
  tenantId = tenant.id;
  primaryBranchId = tenant.branches.find(({ isPrimary }) => isPrimary)!.id;

  const createdBranch = await ownerAgent.post("/api/admin/branches").send({
    slug: "centro",
    name: "Centro",
    timezone: "America/Argentina/Buenos_Aires",
  });
  assert.equal(createdBranch.status, 201);
  secondaryBranchId = createdBranch.body.branch.id as string;

  const staff = await database.user.create({
    data: { email: staffEmail, passwordHash: await bcrypt.hash(password, 12), firstName: "Mozo", lastName: "Prueba", emailVerifiedAt: new Date() },
  });
  staffUserId = staff.id;
  await database.membership.create({ data: { tenantId, userId: staff.id, role: "STAFF" } });
  await database.membershipBranch.create({ data: { tenantId, branchId: primaryBranchId, userId: staff.id, role: "WAITER" } });
  const login = await staffAgent.post("/api/auth/login").send({ email: staffEmail, password, tenantSlug: slug });
  assert.equal(login.status, 200);
});

after(async () => {
  await cleanup();
  await database.$disconnect();
});

test("registro crea una sucursal principal y la expone en el contexto", async () => {
  const context = await ownerAgent.get("/api/auth/me");
  assert.equal(context.status, 200);
  assert.equal(context.body.branch.id, primaryBranchId);
  assert.equal(context.body.branch.slug, "principal");
  assert.equal(context.body.branch.role, null);
});

test("STAFF solo lista sucursales asignadas", async () => {
  const beforeAssignment = await staffAgent.get("/api/admin/branches");
  assert.equal(beforeAssignment.status, 200);
  assert.deepEqual(beforeAssignment.body.branches.map((branch: { id: string }) => branch.id), [primaryBranchId]);

  const assignment = await ownerAgent.put(`/api/admin/branches/${secondaryBranchId}/members/${staffUserId}`).send({ role: "WAITER" });
  assert.equal(assignment.status, 200);
  const afterAssignment = await staffAgent.get("/api/admin/branches");
  assert.equal(afterAssignment.status, 200);
  assert.equal(afterAssignment.body.branches.length, 2);

  const selection = await staffAgent.post("/api/auth/select-branch").send({ branchId: secondaryBranchId });
  assert.equal(selection.status, 200);
  assert.equal(selection.body.branch.id, secondaryBranchId);
  assert.equal(selection.body.branch.role, "WAITER");
  const context = await staffAgent.get("/api/auth/me");
  assert.equal(context.body.branch.id, secondaryBranchId);
});

test("una sucursal de otro tenant no puede modificarse", async () => {
  const other = await request(app).post("/api/auth/register").send({
    email: otherEmail,
    password,
    firstName: "Otro",
    lastName: "Owner",
    storeName: "Otro restaurante",
    storeSlug: otherSlug,
  });
  assert.equal(other.status, 201);
  const otherBranch = await database.branch.findFirstOrThrow({ where: { tenant: { slug: otherSlug }, isPrimary: true } });
  const attempted = await ownerAgent.patch(`/api/admin/branches/${otherBranch.id}`).send({ name: "Intrusión" });
  assert.equal(attempted.status, 404);
  const selection = await staffAgent.post("/api/auth/select-branch").send({ branchId: otherBranch.id });
  assert.equal(selection.status, 403);
});

test("la sucursal principal no puede desactivarse", async () => {
  const response = await ownerAgent.patch(`/api/admin/branches/${primaryBranchId}`).send({ status: "INACTIVE" });
  assert.equal(response.status, 409);
});
