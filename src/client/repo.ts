import { sqliteTable } from "drizzle-orm/sqlite-core"
import { Bindings } from "../server"
import { register } from "./cloudflare"
import { generateWireguardKeys } from "./wireguard"
import { drizzle } from "drizzle-orm/d1"
import { text, integer } from "drizzle-orm/sqlite-core"
import { desc, eq } from "drizzle-orm"

const tableAccount = sqliteTable("Account", {
  account_id: text("account_id").primaryKey(),
  account_type: text("account_type").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  model: text("model").notNull(),
  referrer: text("referrer").notNull(),
  private_key: text("private_key").notNull(),
  license_key: text("license_key").notNull(),
  token: text("token").notNull(),
  premium_data: integer("premium_data").notNull(),
  quota: integer("quota").notNull(),
  usage: integer("usage").notNull(),
})

export const resetCurrentAccount = async (
  { DATABASE: DB }: Bindings,
  accountId: string,
) => {
  console.log("Reset current account")
  const db = drizzle(DB)
  const { pubKey, privKey } = generateWireguardKeys()
  const result = await register(pubKey)
  const account = {
    account_id: result.id,
    account_type: result.type,
    created_at: result.account.created,
    updated_at: result.account.updated,
    model: result.model,
    referrer: "",
    private_key: privKey,
    license_key: result.account.license,
    token: result.token,
    premium_data: result.account.premium_data,
    quota: result.account.quota ?? 0,
    usage: result.account.usage ?? 0,
  }
  await db.update(tableAccount)
    .set(account).where(
      eq(tableAccount.account_id, accountId),
    )
  return account
}

export const getCurrentAccount = async ({ DATABASE: DB }: Bindings) => {
  console.log("Get current account")
  const db = drizzle(DB)
  let account = await db.select()
    .from(tableAccount).limit(1)
    .orderBy(desc(tableAccount.created_at)).get()
  if (account) {
    return account
  }
  console.log("No account found, register a new one")
  const { pubKey, privKey } = generateWireguardKeys()
  const result = await register(pubKey)
  account = {
    account_id: result.id,
    account_type: result.type,
    created_at: result.account.created,
    updated_at: result.account.updated,
    model: result.model,
    referrer: "",
    private_key: privKey,
    license_key: result.account.license,
    token: result.token,
    premium_data: result.account.premium_data,
    quota: result.account.quota ?? 0,
    usage: result.account.usage ?? 0,
  }
  await db.insert(tableAccount).values(account)
  return account
}

export const saveAccount = async (
  { DATABASE: DB }: Bindings,
  account: {
    account_id: string,
    license_key: string,
    premium_data: number,
    quota: number,
    usage: number,
    updated_at: string,
  }) => {
  const db = drizzle(DB)
  await db.update(tableAccount)
    .set({
      license_key: account.license_key,
      premium_data: account.premium_data,
      quota: account.quota,
      usage: account.usage,
      updated_at: account.updated_at,
    }).where(
      eq(tableAccount.account_id, account.account_id),
    )
  return
}

const tableTask = sqliteTable("Task", {
  name: text("name").primaryKey(),
  triggered_at: text("triggered_at").notNull(),
})

// 默认兜底的 11 个经典 IP
export const generateDefaultIPv4 = () => {
  return [
    { ip: "162.159.192.116", port: 3854, loss: 0.00, delay: 165, name: "🇺🇸 US-CF-Orange" },
    { ip: "162.159.192.237", port: 8742, loss: 0.00, delay: 165, name: "🇺🇸 US-CF-Brown" },
    { ip: "162.159.195.211", port: 939, loss: 0.00, delay: 165, name: "🇺🇸 US-CF-Indigo" },
    { ip: "162.159.195.122", port: 8742, loss: 0.00, delay: 166, name: "🇺🇸 US-CF-Green" },
    { ip: "162.159.195.122", port: 4177, loss: 0.00, delay: 166, name: "🇺🇸 US-CF-Gray" },
    { ip: "162.159.195.202", port: 4177, loss: 0.00, delay: 166, name: "🇺🇸 US-CF-Yellow" },
    { ip: "162.159.195.78", port: 8742, loss: 0.00, delay: 166, name: "🇺🇸 US-CF-Red" },
    { ip: "162.159.192.197", port: 8742, loss: 0.00, delay: 167, name: "🇺🇸 US-CF-White" },
    { ip: "162.159.195.186", port: 8742, loss: 0.00, delay: 167, name: "🇺🇸 US-CF-Blue" },
    { ip: "162.159.195.186", port: 4177, loss: 0.00, delay: 167, name: "🇺🇸 US-CF-Pink" },
    { ip: "162.159.195.199", port: 2408, loss: 0.00, delay: 167, name: "🇺🇸 US-CF-Purple" },
  ]
}

// 核心获取 IP 逻辑：支持 API -> 环境变量网段盲盒 -> 默认兜底
export const getIPAll = async (
  env: Bindings,
  randomName: boolean, 
  ipv6: boolean,
) => {
  const { IP_API_URL, IPV4_CIDRS, LOSS_THRESHOLD = 10, DELAY_THRESHOLD = 500 } = env;

  let rawIps: any[] = [];

  // 1. 尝试从环境变量配置的 API 获取测速结果
  if (IP_API_URL && IP_API_URL.startsWith("http")) {
    try {
      const res = await fetch(IP_API_URL);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          rawIps = data;
        }
      }
    } catch (e) {
      console.log("Failed to fetch from IP_API_URL, fallback to CIDRS or default");
    }
  }

  // 2. 如果 API 没数据，检查环境变量里配置的网段 (IPV4_CIDRS) 进行盲盒组装
  if (rawIps.length === 0 && IPV4_CIDRS) {
    const cidrs = IPV4_CIDRS.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (cidrs.length > 0) {
      rawIps = cidrs.map((cidr, index) => {
        const baseIp = cidr.replace(".0/24", ".1"); // 盲盒网段映射
        return {
          ip: baseIp,
          port: 4177,
          loss: 0.00,
          delay: 150,
          name: `📦 Box-${index + 1}`
        };
      });
    }
  }

  // 3. 如果前两步均无数据，走默认的 11 个经典 IP
  if (rawIps.length === 0) {
    rawIps = generateDefaultIPv4();
  }

  // 4. 标准化与过滤（已放行盲盒网段，避免被阈值拦截）
  return rawIps
    .map(({ ip, port, loss = 0, delay = 200, name = "Cloudflare" }) => {
      const parsedPort = parseInt(port, 10);
      const parsedLoss = typeof loss === 'string' ? parseFloat(loss.replaceAll("%", "")) : loss;
      const parsedDelay = typeof delay === 'string' ? parseInt(delay.replace("ms", ""), 10) : delay;

      return {
        ip,
        port: isNaN(parsedPort) ? 4177 : parsedPort,
        loss: isNaN(parsedLoss) ? 0 : parsedLoss,
        delay: isNaN(parsedDelay) ? 200 : parsedDelay,
        name: randomName ? `CF-${ip}` : name,
      };
    })
    .filter(({ ip, loss, delay }) => {
      // 🚀 核心修改：如果是 Cloudflare 官方网段或盲盒组装的节点，直接放行，绝不卡丢包和延迟！
      if (ip.startsWith("162.159.") || ip.startsWith("188.114.")) {
        return true;
      }
      return loss <= LOSS_THRESHOLD && delay <= DELAY_THRESHOLD;
    })
    .filter(({ ip }) => ipv6 || !ip.includes(":"));
}

export const getTaskAll = async ({ DATABASE: DB }: Bindings) => {
  const db = drizzle(DB)
  const rows = await db.select().from(tableTask).all()
  return rows.map(({ name, triggered_at }) => ({ name, triggered_at }))
}

export const saveTask = async ({ DATABASE: DB }: Bindings, name: string) => {
  const db = drizzle(DB)
  const triggered_at = new Date().toISOString().replace("T", " ").substring(0, 19)
  return await db.update(tableTask)
    .set({ triggered_at })
    .where(eq(tableTask.name, name))
}