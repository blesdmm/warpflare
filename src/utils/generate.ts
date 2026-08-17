import { CLASH, SING_BOX } from "./config";
import YAML from 'yaml';

const CF_PUBLIC_KEY = "bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=";

export enum SubType {
  Clash,
  Shadowrocket,
  Surge,
  SingBox,
  Unknown,
}

export enum ProxyFormat {
  Only,
  Group,
  Full,
}

export const generateClash = (
  ips: {
    ip: string,
    port: number,
    name: string,
  }[],
  privateKey: string,
  proxyFormat: ProxyFormat = ProxyFormat.Full,
  _isAndroid: boolean,
) => {
  const config = Object.assign({}, {
    type: "wireguard",
    ip: "172.16.0.2",
    udp: true,
    mtu: 1280,
    "public-key": CF_PUBLIC_KEY,
    "remote-dns-resolve": true,
    "private-key": privateKey,
  });
  const proxies = ips.map(({ ip: server, port, name }) =>
    Object.assign({}, { server, name, port }, config));
  const clash = Object.assign({}, structuredClone(CLASH), { proxies: structuredClone(proxies) });
  clash["proxy-groups"][1] = Object.assign({}, clash["proxy-groups"][1],
    { proxies: structuredClone(proxies.map(({ name }) => name)) });
  
  if (proxyFormat == ProxyFormat.Only) {
    return YAML.stringify({ "proxies": clash.proxies });
  } else if (proxyFormat == ProxyFormat.Group) {
    return YAML.stringify({ "proxies": clash.proxies, "proxy-groups": clash["proxy-groups"] });
  }
  return YAML.stringify(clash);
};

export const generateSingBox = (
  ips: {
    ip: string,
    port: number,
    name: string,
  }[],
  privateKey: string,
) => {
  const config = {
    type: "wireguard",
    local_address: ["172.16.0.2/32"],
    private_key: privateKey,
    peer_public_key: CF_PUBLIC_KEY,
    system_interface: false,
    mtu: 1280,
  };
  
  const outbounds = ips.map(({ ip: server, port: server_port, name: tag }) =>
    Object.assign({}, {
      server,
      server_port,
      peers: [{
        server,
        server_port,
        public_key: CF_PUBLIC_KEY,
        pre_shared_key: "",
        allowed_ips: ['0.0.0.0/0', '::/0'],
      }],
      tag,
    }, config));
  
  const names = ips.map(({ name }) => name);
  const singBox = structuredClone(SING_BOX);
  singBox.outbounds.push(...outbounds);
  
  for (let idx of [0, 1]) {
    const obs = singBox.outbounds[idx].outbounds as string[];
    obs.push(...names);
  }
  
  return JSON.stringify(singBox, null, 2);
};

export const generateShadowrocket = (
  ips: {
    ip: string,
    port?: number,
    name: string,
  }[],
  privateKey: string,
  env: { RANDOM_PORT_ENABLED?: string } = {} // 关键：给 env 加上默认空对象兜底 {}
) => {
  // 你的自定义端口池
  const ports = [854, 859, 864, 878, 880, 890, 891, 894, 903, 908, 928, 934, 939, 942, 943, 945, 946, 955, 968, 987, 988, 1002, 1010, 1014, 1018, 1070, 1074, 1180, 1387, 1843, 2371, 2506, 3138, 3476, 3581, 3854, 4177, 4198, 4233, 5279, 5956, 7103, 7152, 7156, 7281, 7559, 8319, 8742, 8854, 8886, 2408, 500, 4500, 1701];

  // 稳妥读取：即使 env 为 undefined 或没传，也不会报错
  const RANDOM_PORT_ENABLED = env?.RANDOM_PORT_ENABLED !== "false";

  // 随机选择端口的函数
  const getRandomPort = (portsArray: number[]) => {
    const randomIndex = Math.floor(Math.random() * portsArray.length);
    return portsArray[randomIndex];
  };

  // 生成 URLs 的代码
  const urls = ips.map((node) => {
    const server = node.ip || "0.0.0.0";
    const name = node.name || "Unknown";

    // 根据后台开关决定：开随机或者节点没端口时，从 ports 里抽；否则用它自带的 port
    const port = (RANDOM_PORT_ENABLED || !node.port)
      ? getRandomPort(ports)
      : node.port;

    // 对私钥和带有 /32 的地址进行 URL 编码，避免在手机端被截断
    const encodedPrivateKey = encodeURIComponent(privateKey);
    const encodedAddress = encodeURIComponent("172.16.0.2/32");

    return `wireguard://${encodedPrivateKey}@${server}:${port}?`
      + `address=${encodedAddress}&`
      + `publickey=${encodeURIComponent(CF_PUBLIC_KEY)}&`
      + `dns=1.1.1.1,1.0.0.1&`
      + `mtu=1280&`
      + `udp=1&`
      + `stack=system&`
      + `flag=${name.split('-')[0].replace(/[^\x00-\x7F]/g, "")}#${encodeURIComponent(name)}`;
  });

  return btoa(urls.join("\n"));
};