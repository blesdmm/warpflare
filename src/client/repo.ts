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
  // NOTE: To register a brand new account, an old pubKey cannot be used as
  // doing so will result in an Unauthorized error.
  // Therefore, it is necessary to regenerate the key pair.
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
  // FIXME: construct db from context
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

const tableIP = sqliteTable("IP", {
  address: text("address").primaryKey(),
  loss: text("loss").notNull(),
  delay: text("delay").notNull(),
  name: text("name").notNull(),
  unique_name: text("unique_name").notNull()
})

// 默认兜底的 IP 地址生成函数
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
  ];
};

// 从 API 获取 IP 地址的函数
export const fetchIPFromAPI = async (apiUrl) => {
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.map(({ ip, port, loss, delay, name }) => ({
      ip,
      port,
      loss,
      delay,
      name
    }));
  } catch (error) {
    console.error("Failed to fetch IP addresses:", error);
    return []; // 返回空数组以防止后续操作出错
  }
};

// 获取 IP 地址，优先从 API 获取，不成功则使用默认值
export const getIPAddresses = async (apiUrl) => {
  const ipAddresses = await fetchIPFromAPI(apiUrl);
  // 如果从 API 获取 IP 地址失败，则使用默认地址
  return ipAddresses.length > 0 ? ipAddresses : generateDefaultIPv4();
};

// 更新 getIPAll 函数以适配获取 IP 地址的逻辑
export const getIPAll = async (
  { DATABASE: DB, LOSS_THRESHOLD = 10, DELAY_THRESHOLD = 500 }: Bindings,
  randomName: boolean,
  ipv6: boolean,
  apiUrl: string // 传入 API URL
) => {
  const db = drizzle(DB);

  // 从 API 获取 IP 地址或使用默认值
  const ipAddresses = await getIPAddresses(apiUrl);

  return ipAddresses
    .map(({ ip, port, loss, delay, name }) => {
      name = randomName ? unique_name : name;
      const parsedPort = parseInt(port, 10);
      return {
        ip,
        port: isNaN(parsedPort) ? 4177 : parsedPort,
        loss: parseFloat(loss),
        delay: parseInt(delay, 10),
        name,
      };
    })
    .filter(({ loss, delay }) =>
      loss <= LOSS_THRESHOLD && delay <= DELAY_THRESHOLD
    )
    .filter(({ ip }) => ipv6 || !ip.includes(":"));
};

// 示例调用
const initializeIPList = async () => {
  // 自定义 API 地址，若需要更改可以在此处修改
  const API_URL = "https://raw.githubusercontent.com/blesdmm/WARP-Clash-API/refs/heads/master/config/result.csv"; // 替换为实际的 API 地址

  try {
    const ipData = await getIPAll({ DATABASE: dbInstance }, true, false, API_URL);
    console.log("Fetched IP Addresses:", ipData);
    // 对 IP 数据进行进一步处理
  } catch (error) {
    console.error("Error fetching IP addresses:", error);
  }
};

// 启动函数以获取 IP 地址
initializeIPList();

export const getIPAll = async (
  { DATABASE: DB, LOSS_THRESHOLD = 10, DELAY_THRESHOLD = 500 }: Bindings,
  randomName: boolean, ipv6: boolean,
) => {
  const db = drizzle(DB)
  const rows = await db.select().from(tableIP).all()
  return rows.map(({ address, loss, delay, name, unique_name }) => {
    name = randomName ? unique_name : name
    const [ip, port] = splitIpPort(address)
    
    // 强制修复：解析端口，如果解析失败（如得到 NaN），强制默认为 4177
    const parsedPort = parseInt(port, 10);
    return {
      ip,
      port: isNaN(parsedPort) ? 4177 : parsedPort, 
      loss: parseFloat(loss.replaceAll("%", "")),
      delay: parseInt(delay.replace("ms", ""), 10),
      name,
    }
  }).filter(({ loss, delay }) =>
    loss <= LOSS_THRESHOLD && delay <= DELAY_THRESHOLD)
    .filter(({ ip }) => ipv6 || !ip.includes(":"))
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