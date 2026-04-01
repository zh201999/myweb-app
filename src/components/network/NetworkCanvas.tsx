"use client";

import { useEffect, useMemo, useRef } from "react";
import * as networkDataModule from "./networkData";

type GenericContact = {
  id?: number | string;
  name?: string;
  title?: string;
  company?: string;
  sector?: string;
  [key: string]: unknown;
};

function getContactsFromModule(): GenericContact[] {
  const exportedValues = Object.values(networkDataModule);
  const firstArray = exportedValues.find((value) => Array.isArray(value));
  return Array.isArray(firstArray) ? (firstArray as GenericContact[]) : [];
}

export default function NetworkCanvas() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const contacts = useMemo(() => getContactsFromModule(), []);
  const sectors = useMemo(() => {
    const unique = new Set<string>();

    contacts.forEach((contact) => {
      const sector = String(contact.sector ?? "Uncategorized").trim() || "Uncategorized";
      unique.add(sector);
    });

    return Array.from(unique);
  }, [contacts]);

  useEffect(() => {
    if (!containerRef.current) return;

    let network: { destroy: () => void } | null = null;

    const init = async () => {
      const { DataSet, Network } = await import("vis-network/standalone");

      const nodes: Array<Record<string, unknown>> = [
        {
          id: "self",
          label: "You",
          shape: "dot",
          size: 36,
          color: {
            background: "#0f172a",
            border: "#60a5fa",
          },
          font: {
            color: "#ffffff",
            size: 18,
          },
          borderWidth: 3,
        },
      ];

      const edges: Array<Record<string, unknown>> = [];

      sectors.forEach((sector, index) => {
        const sectorId = `sector-${sector}`;

        nodes.push({
          id: sectorId,
          label: sector,
          shape: "dot",
          size: 24,
          color: {
            background: ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"][index % 5],
            border: ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"][index % 5],
          },
          font: {
            color: "#ffffff",
            size: 14,
          },
          borderWidth: 2,
        });

        edges.push({
          from: "self",
          to: sectorId,
          color: { color: "rgba(148,163,184,0.4)" },
          width: 2,
        });
      });

      contacts.forEach((contact, index) => {
        const sector = String(contact.sector ?? "Uncategorized").trim() || "Uncategorized";
        const company = String(contact.company ?? "Independent").trim() || "Independent";
        const name = String(contact.name ?? `Contact ${index + 1}`).trim() || `Contact ${index + 1}`;

        const sectorId = `sector-${sector}`;
        const companyId = `company-${sector}-${company}`;
        const contactId = `contact-${String(contact.id ?? index + 1)}`;

        const companyAlreadyExists = nodes.some((node) => node.id === companyId);

        if (!companyAlreadyExists) {
          nodes.push({
            id: companyId,
            label: company,
            shape: "dot",
            size: 18,
            color: {
              background: "#111827",
              border: "#94a3b8",
            },
            font: {
              color: "#ffffff",
              size: 13,
            },
            borderWidth: 2,
          });

          edges.push({
            from: sectorId,
            to: companyId,
            color: { color: "rgba(148,163,184,0.35)" },
            width: 1.5,
          });
        }

        nodes.push({
          id: contactId,
          label: name,
          shape: "dot",
          size: 12,
          color: {
            background: "#020617",
            border: "#cbd5e1",
          },
          font: {
            color: "#ffffff",
            size: 12,
          },
          borderWidth: 2,
        });

        edges.push({
          from: companyId,
          to: contactId,
          color: { color: "rgba(148,163,184,0.25)" },
          width: 1,
        });
      });

      const data = {
        nodes: new DataSet(nodes),
        edges: new DataSet(edges),
      };

      const options = {
        autoResize: true,
        height: "100%",
        width: "100%",
        interaction: {
          hover: true,
          navigationButtons: true,
          keyboard: true,
        },
        physics: {
          enabled: true,
          stabilization: {
            enabled: true,
            iterations: 200,
          },
          barnesHut: {
            gravitationalConstant: -4000,
            centralGravity: 0.2,
            springLength: 140,
            springConstant: 0.03,
            damping: 0.12,
            avoidOverlap: 0.3,
          },
        },
        layout: {
          improvedLayout: true,
        },
      };

      network = new Network(containerRef.current!, data, options);
    };

    init();

    return () => {
      network?.destroy();
    };
  }, [contacts, sectors]);

  return (
    <div className="h-full w-full bg-slate-950">
      <div className="border-b border-slate-800 px-5 py-3">
        <h2 className="text-sm font-semibold text-white">Network Map</h2>
        <p className="text-xs text-slate-400">
          Contacts: {contacts.length} • Sectors: {sectors.length}
        </p>
      </div>

      <div className="h-[calc(100%-57px)] w-full" ref={containerRef} />
    </div>
  );
}