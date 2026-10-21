import { describe, expect, it } from "vitest";
import { demoBusinessAction, demoRecords } from "./demo-store";
import { demoState } from "./demo";
import type { Sale } from "./business";

const costOf = (saleId: string) => demoRecords().sales.find((sale) => sale.id === saleId)!.deliveryCostMinor;
const deliveryOf = (saleId: string) => demoRecords().sales.find((sale) => sale.id === saleId)!.delivery!;

describe("demo deliveries and their cost", () => {
  it("drops a cancelled or removed delivery's cost from its sale and restores it when it goes out again", () => {
    // Online store, no address: no zone, so the delivery cost is the one given.
    const { id } = demoBusinessAction<{ id: string }>({ action: "record-sale", sale: { soldOn: "2026-09-30", channelId: "tienda", items: [{ productId: demoState.products[0].id, quantity: 1 }], deliveryCost: 3500 } });
    expect(costOf(id)).toBe(3500);
    const delivery = deliveryOf(id).id;
    demoBusinessAction({ action: "save-delivery", delivery: { id: delivery, status: "cancelled" } });
    expect(costOf(id)).toBe(0);
    // Back on track: the channel's cost per order comes back.
    demoBusinessAction({ action: "save-delivery", delivery: { id: delivery, status: "pending" } });
    expect(costOf(id)).toBe(3500);
    // A cost given with the cancellation (a courier's fee) is kept.
    demoBusinessAction({ action: "save-delivery", delivery: { id: delivery, status: "cancelled", cost: 800 } });
    expect(costOf(id)).toBe(800);
    demoBusinessAction({ action: "save-delivery", delivery: { id: delivery, status: "pending", cost: 3500 } });
    // Removing the delivery leaves the sale without delivery cost; making a new one brings the channel's back.
    demoBusinessAction({ action: "archive", kind: "delivery", id: delivery });
    expect(costOf(id)).toBe(0);
    demoBusinessAction({ action: "save-delivery", delivery: { saleId: id, scheduledOn: "2026-10-02" } });
    expect(costOf(id)).toBe(3500);
  });

  it("keeps a zone's cost, or none for a cancelled delivery, when the sale moves to another channel", () => {
    const { id } = demoBusinessAction<{ id: string }>({ action: "record-sale", sale: { soldOn: "2026-09-30", channelId: "tienda", items: [{ productId: demoState.products[0].id, quantity: 1 }], delivery: { zoneId: "z-santiago", address: "Irarrázaval 100, Ñuñoa" } } });
    expect(costOf(id)).toBe(3000);
    // Wholesale delivers at 6000 per order, but this delivery goes through its zone at 3000.
    demoBusinessAction({ action: "update-sale", id, patch: { channelId: "librerias" } });
    expect(costOf(id)).toBe(3000);
    demoBusinessAction({ action: "save-delivery", delivery: { id: deliveryOf(id).id, status: "cancelled" } });
    demoBusinessAction({ action: "update-sale", id, patch: { channelId: "tienda" } });
    expect(costOf(id)).toBe(0);
  });
});

describe("collecting in the demo", () => {
  it("records a sale as owed, lists it with what customers owe and collects it", () => {
    const { id } = demoBusinessAction<{ id: string }>({ action: "record-sale", sale: { soldOn: "2026-09-26", channelId: "feria", items: [{ productId: demoState.products[0].id, quantity: 2 }], customer: "Ana", paidAmount: 0 } });
    expect(demoRecords().owed?.some((sale) => sale.id === id)).toBe(true);
    const paid = demoBusinessAction<Sale>({ action: "update-sale", id, patch: { markPaid: true, paymentMethod: "cash" } });
    expect(paid).toMatchObject({ paymentMethod: "cash", paidOn: "2026-09-26" });
    expect(paid.paidMinor).toBe(paid.totalMinor);
    expect(demoRecords().owed?.some((sale) => sale.id === id)).toBe(false);
  });
});
