import { describe, expect, it } from "vitest";
import { buildCustomerList, customerConcentration, customerKey, customersFromHistory, customerStats, directoryFromCustomers, zoneFromAddress, type Customer, type CustomerSale } from "./customers";

const sale = (id: string, customerId: string | null, soldOn: string, total = 1000): CustomerSale => ({ id, customerId, soldOn, channelName: "Tienda", items: "1 × Tofu", totalMinor: total, variableCostMinor: total * 0.5, sellingCostMinor: 50, deliveryCostMinor: 0 });
const customer = (id: string, name: string): Customer => ({ id, name, phone: "", email: "", notes: "", source: "user", createdAt: "2026-01-01 10:00:00", addresses: [] });

describe("customers", () => {
  it("joins the same customer written differently, and guesses the zone of an address", () => {
    expect(customerKey("  Librería  El Ateneo ")).toBe(customerKey("libreria el ateneo."));
    expect(zoneFromAddress("Av. Colón 1450, Córdoba")).toBe("Córdoba");
    expect(zoneFromAddress("San Martín 220")).toBe("");
  });

  it("builds customers from typed names and their delivery addresses, the latest address as default", () => {
    const imported = customersFromHistory([
      { customer: "Librería El Ateneo", soldOn: "2026-08-02", address: "San Martín 220, Rosario", recipient: "Marta", contact: "341 555 0101" },
      { customer: "libreria el ateneo", soldOn: "2026-09-10", address: "Depósito Sur 88, Rosario", recipient: "Librería El Ateneo" },
      { customer: "", soldOn: "2026-09-11", address: "Nadie 1" },
    ]);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ name: "libreria el ateneo", phone: "341 555 0101", names: ["libreria el ateneo", "Librería El Ateneo"] });
    expect(imported[0].addresses.map((item) => [item.address, item.zone, item.isDefault])).toEqual([["Depósito Sur 88, Rosario", "Rosario", true], ["San Martín 220, Rosario", "Rosario", false]]);
    // A recipient that is the customer itself is not repeated as "who receives".
    expect(imported[0].addresses[0].recipient).toBe("");
  });

  it("describes how each customer buys: frequent, at risk, inactive, new", () => {
    const today = "2026-09-26";
    expect(customerStats([sale("a", "c", "2026-08-01"), sale("b", "c", "2026-08-20"), sale("c", "c", "2026-09-15")], today)).toMatchObject({ sales: 3, everyDays: 23, status: "frequent", daysSinceLast: 11, left: 1350 });
    expect(customerStats([sale("a", "c", "2026-05-01"), sale("b", "c", "2026-05-15")], today).status).toBe("inactive");
    expect(customerStats([sale("a", "c", "2026-06-20"), sale("b", "c", "2026-07-05")], today).status).toBe("at-risk");
    expect(customerStats([sale("a", "c", "2026-09-10")], today).status).toBe("new");
    expect(customerStats([], today).status).toBe("none");
    expect(customerStats([{ ...sale("a", "c", "2026-09-10"), variableCostMinor: null }], today).left).toBeNull();
  });

  it("lists the most recent buyer first and measures how concentrated sales are", () => {
    const rows = buildCustomerList([customer("a", "Ana"), customer("b", "Bruno"), customer("c", "Carla"), customer("d", "Dora"), customer("e", "Eva")], [
      sale("1", "a", "2026-09-01", 9000), sale("2", "b", "2026-09-20", 500), sale("3", "c", "2026-08-01", 300), sale("4", "d", "2026-07-01", 200),
    ], "2026-09-26");
    expect(rows.map((row) => row.name)).toEqual(["Bruno", "Ana", "Carla", "Dora", "Eva"]);
    expect(customerConcentration(rows)).toEqual({ top: 3, share: 9800 / 10000 });
    const directory = directoryFromCustomers([{ ...rows[1], addresses: [{ id: "x", label: "", address: "Mitre 10", zone: "", recipient: "Portería", contact: "351", notes: "", isDefault: true }] }], { customers: [], recipients: ["Marta"], addresses: ["Belgrano 1"], carriers: ["Moto"] });
    expect(directory.customers[0]).toMatchObject({ name: "Ana", address: "Mitre 10", recipient: "Portería", contact: "351", sales: 1 });
    expect(directory.addresses).toEqual(["Mitre 10", "Belgrano 1"]);
  });
});
