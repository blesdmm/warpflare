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

// 核心获取 IP 逻辑：支持 CSV 解析、多节点随机盲盒组装、环境变量提取
export const getIPAll = async (
  env: Bindings,
  randomName: boolean, 
  ipv6: boolean,
) => {
  const ipApiUrl = env.IP_API_URL;
  const ipv4Cidrs = env.IPV4_CIDRS;
  const lossThreshold = env.LOSS_THRESHOLD ?? 10;
  const delayThreshold = env.DELAY_THRESHOLD ?? 500;
  const targetCount = env.RANDOM_COUNT ?? 300;

  let rawIps: any[] = [];

  // 1. 尝试从后台变量 IP_API_URL 获取（完美支持 CSV 格式及 JSON 格式）
  if (ipApiUrl && ipApiUrl.startsWith("http")) {
    try {
      const res = await fetch(ipApiUrl);
      if (res.ok) {
        const text = await res.text();
        if (text.includes("IP:Port") || text.includes(",")) {
          const lines = text.split(/\r?\n/);
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const parts = line.split(",");
            if (parts.length >= 3) {
              const [ipPort, lossStr, latencyStr] = parts;
              const [ip, port] = ipPort.split(":");
              if (ip && port) {
                rawIps.push({
                  ip: ip.trim(),
                  port: parseInt(port.trim(), 10),
                  loss: lossStr.trim(),
                  delay: latencyStr.trim(),
                  name: `CSV-${ip.trim()}`
                });
              }
            }
          }
        } else {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 0) {
            rawIps = data;
          }
        }
      }
    } catch (e) {
      console.log("Failed to fetch or parse IP_API_URL, fallback to CIDRS or default");
    }
  }

  // 2. 如果 API 没数据，检查后台变量 IPV4_CIDRS 进行多节点盲盒组装（随机生成几百个 IP）
  if (rawIps.length === 0 && ipv4Cidrs) {
    const cidrs = ipv4Cidrs.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean);
    if (cidrs.length > 0) {
      const ports = [4177, 2408, 8742, 3854, 939];
      const perCidr = Math.max(1, Math.floor(targetCount / cidrs.length));

      for (const cidr of cidrs) {
        const cleanCidr = cidr.includes('/') ? cidr.split('/')[0] : cidr;
        const prefix = cleanCidr.replace(/\.\d+$/, '');
        
        for (let i = 0; i < perCidr; i++) {
          const randomHost = Math.floor(Math.random() * 253) + 2;
          const randomPort = ports[Math.floor(Math.random() * ports.length)];
          rawIps.push({
            ip: `${prefix}.${randomHost}`,
            port: randomPort,
            loss: 0.00,
            delay: Math.floor(Math.random() * 50) + 150,
            name: `📦 Box-${prefix}.${randomHost}`
          });
        }
      }
    }
  }

  // 3. 如果前两步均无数据，走默认的 11 个经典 IP
  if (rawIps.length === 0) {
    rawIps = generateDefaultIPv4();
  }

  // 4. 标准化与过滤（官方网段与 CSV/盲盒测速节点强制放行）
  return rawIps
    .map(({ ip, port, loss = 0, delay = 200, name = "Cloudflare" }) => {
      const parsedPort = parseInt(port, 10);
      const parsedLoss = typeof loss === 'string' ? parseFloat(loss.replaceAll("%", "")) : loss;
      const parsedDelay = typeof delay === 'string' ? parseFloat(delay.replace("ms", "").replace("s", "")) : Number(delay);

      return {
        ip,
        port: isNaN(parsedPort) ? 4177 : parsedPort,
        loss: isNaN(parsedLoss) ? 0 : parsedLoss,
        delay: isNaN(parsedDelay) ? 200 : parsedDelay,
        name: randomName ? `CF-${ip}` : name,
      };
    })
    .filter(({ ip, loss, delay }) => {
      // 🚀 核心放行：如果是官方网段或测速/盲盒节点，直接通过，绝不卡阈值
      if (ip.startsWith("162.159.") || ip.startsWith("188.114.")) {
        return true;
      }
      return loss <= lossThreshold && delay <= delayThreshold;
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