"use strict";

// Pass each interface's full CIDR range to the Rust scanner.
function scanSubnets(interfaces) {
  const subnets = new Set();
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (/^(docker|br-|veth)/.test(name)) continue;
    for (const iface of addresses || []) {
      if (iface.internal || iface.family !== "IPv4") continue;
      subnets.add(iface.cidr || `${iface.address}/24`);
    }
  }
  return [...subnets];
}

module.exports = { scanSubnets };
