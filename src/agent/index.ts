import { randomUUID } from "crypto";

export enum Role {
  ROOT,
  MASTER,
  SLAVE,
}

export enum AgentStatus {
  ACTIVE,
  IDLE,
}

export class Agent {
  readonly uuid: string;
  readonly role: Role;
  status: AgentStatus = AgentStatus.IDLE;

  constructor(role: Role, uuid?: string) {
    this.uuid = uuid ?? randomUUID();
    this.role = role;
  }
}

/** Singleton, system-built-in master */
export class RootAgent extends Agent {
  private static instance: RootAgent | null = null;
  private masters: MasterAgent[] = [];

  private constructor(uuid?: string) {
    super(Role.ROOT, uuid);
  }

  static getInstance(): RootAgent {
    if (!RootAgent.instance) {
      RootAgent.instance = new RootAgent();
    }
    return RootAgent.instance;
  }

  static reset(): void {
    RootAgent.instance = null;
  }

  addMaster(master: MasterAgent): void {
    this.masters.push(master);
  }

  getMasters(): readonly MasterAgent[] {
    return this.masters;
  }
}

export class MasterAgent extends Agent {
  readonly maxSlaves: number;
  private slaves: SlaveAgent[] = [];

  constructor(maxSlaves: number, uuid?: string) {
    super(Role.MASTER, uuid);
    this.maxSlaves = maxSlaves;
  }

  addSlave(slave: SlaveAgent): boolean {
    if (this.slaves.length >= this.maxSlaves) return false;
    this.slaves.push(slave);
    return true;
  }

  getSlaves(): readonly SlaveAgent[] {
    return this.slaves;
  }
}

export class SlaveAgent extends Agent {
  constructor(uuid?: string) {
    super(Role.SLAVE, uuid);
  }
}

/** Hierarchy: root (system master) -> masters -> slaves */
export class Hierarchy {
  readonly root = RootAgent.getInstance();

  static readonly instance = new Hierarchy();

  /** Get agent by path: "root" | "root::<master_uuid>" | "root::<master_uuid>::<slave_uuid>" */
  get(path: string): Agent | undefined {
    const parts = path.split("::").filter(Boolean);
    if (parts.length === 0) return undefined;
    if (parts[0] !== "root") return undefined;

    if (parts.length === 1) return this.root;

    const master = this.root.getMasters().find((m) => m.uuid === parts[1]);
    if (!master) return undefined;
    if (parts.length === 2) return master;

    const slave = master.getSlaves().find((s) => s.uuid === parts[2]);
    return slave;
  }

  /** Index by path: "root" or "master_uuid::slave_uuid" */
  index(path: string): Agent | undefined {
    if (path === "root") return this.root;
    const parts = path.split("::");
    if (parts.length === 2) {
      const master = this.root.getMasters().find((m) => m.uuid === parts[0]);
      return master?.getSlaves().find((s) => s.uuid === parts[1]);
    }
    return this.get(path);
  }

  /** Output hierarchy as string */
  format(): string {
    const lines: string[] = ["root"];
    for (const master of this.root.getMasters()) {
      for (const slave of master.getSlaves()) {
        lines.push(`${master.uuid}::${slave.uuid}`);
      }
    }
    return lines.join("\n");
  }

  /** All paths for iteration */
  paths(): string[] {
    const result: string[] = ["root"];
    for (const master of this.root.getMasters()) {
      result.push(`root::${master.uuid}`);
      for (const slave of master.getSlaves()) {
        result.push(`${master.uuid}::${slave.uuid}`);
      }
    }
    return result;
  }
}

export const hierarchy = Hierarchy.instance;
