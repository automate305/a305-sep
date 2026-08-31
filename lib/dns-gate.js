import dns from "dns/promises";

const BLOCKLISTS = [
  "zen.spamhaus.org",
  "b.barracudacentral.org",
  "bl.spamcop.net",
];

function reverseIp(ip) {
  return ip.split(".").reverse().join(".");
}

async function checkMx(domain) {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length === 0) return { pass: false, details: "No MX records found" };
    return {
      pass: true,
      details: records.map((r) => `${r.priority} ${r.exchange}`).join(", "),
    };
  } catch (err) {
    return { pass: false, details: `MX lookup failed: ${err.code || err.message}` };
  }
}

async function countSpfLookups(record, seen = new Set()) {
  let count = 0;
  const parts = record.split(/\s+/);
  for (const part of parts) {
    const lower = part.toLowerCase();
    let target = null;
    if (lower.startsWith("include:")) {
      target = lower.slice(8);
    } else if (lower.startsWith("redirect=")) {
      target = lower.slice(9);
    } else if (lower.startsWith("a:") || lower.startsWith("mx:")) {
      count++;
      continue;
    } else if (lower === "a" || lower === "mx") {
      count++;
      continue;
    } else if (lower.startsWith("exists:")) {
      count++;
      continue;
    } else if (lower.startsWith("ptr") || lower === "ptr") {
      count++;
      continue;
    } else {
      continue;
    }
    if (target && !seen.has(target)) {
      seen.add(target);
      count++;
      try {
        const txts = await dns.resolveTxt(target);
        const spf = txts.flat().find((t) => t.startsWith("v=spf1"));
        if (spf) count += await countSpfLookups(spf, seen);
      } catch {
        // unresolvable include
      }
    }
  }
  return count;
}

async function checkSpf(domain, spfInclude) {
  try {
    const txts = await dns.resolveTxt(domain);
    const spfRecord = txts.flat().find((t) => t.startsWith("v=spf1"));
    if (!spfRecord) return { pass: false, details: "No SPF record found", lookupCount: 0 };

    const includesProvider = spfRecord
      .toLowerCase()
      .includes(`include:${spfInclude.toLowerCase()}`);
    const lookupCount = await countSpfLookups(spfRecord);
    const underLimit = lookupCount <= 10;

    return {
      pass: includesProvider && underLimit,
      details: !includesProvider
        ? `SPF missing include:${spfInclude}`
        : !underLimit
          ? `SPF lookup count ${lookupCount} exceeds 10`
          : `SPF valid, ${lookupCount} lookups`,
      lookupCount,
    };
  } catch (err) {
    return {
      pass: false,
      details: `SPF lookup failed: ${err.code || err.message}`,
      lookupCount: 0,
    };
  }
}

async function checkDkim(domain, dkimSelector) {
  const target = `${dkimSelector}._domainkey.${domain}`;
  try {
    const txts = await dns.resolveTxt(target);
    const joined = txts.flat().join("");
    if (/p=/.test(joined)) {
      return { pass: true, details: `DKIM key found at ${target}` };
    }
    return { pass: false, details: `DKIM record at ${target} missing public key (p=)` };
  } catch (err) {
    return { pass: false, details: `DKIM lookup failed for ${target}: ${err.code || err.message}` };
  }
}

async function checkDmarc(domain) {
  const target = `_dmarc.${domain}`;
  try {
    const txts = await dns.resolveTxt(target);
    const record = txts.flat().find((t) => t.startsWith("v=DMARC1"));
    if (!record) return { pass: false, details: "No DMARC record found" };
    return { pass: true, details: record };
  } catch (err) {
    return { pass: false, details: `DMARC lookup failed: ${err.code || err.message}` };
  }
}

async function getMxIps(domain) {
  const ips = [];
  try {
    const mxRecords = await dns.resolveMx(domain);
    for (const mx of mxRecords) {
      try {
        const addrs = await dns.resolve4(mx.exchange);
        ips.push(...addrs);
      } catch {
        // skip unresolvable exchanges
      }
    }
  } catch {
    // no MX records
  }
  return [...new Set(ips)];
}

async function checkBlacklist(domain) {
  const ips = await getMxIps(domain);
  if (ips.length === 0) {
    return { pass: true, details: "No MX IPs to check" };
  }

  const listings = [];
  for (const ip of ips) {
    const reversed = reverseIp(ip);
    for (const bl of BLOCKLISTS) {
      const query = `${reversed}.${bl}`;
      try {
        await dns.resolve4(query);
        listings.push(`${ip} listed on ${bl}`);
      } catch {
        // NXDOMAIN = not listed
      }
    }
  }

  return listings.length === 0
    ? { pass: true, details: `${ips.length} IP(s) clean across all blocklists` }
    : { pass: false, details: listings.join("; ") };
}

function checkPostmaster() {
  return { verified: false, details: "Google Postmaster Tools: no data" };
}

export async function checkDns(brand, provider) {
  const { domain } = brand;
  const { spfInclude, dkimSelector } = provider;

  const [mx, spf, dkim, dmarc, blacklist] = await Promise.all([
    checkMx(domain),
    checkSpf(domain, spfInclude),
    checkDkim(domain, dkimSelector),
    checkDmarc(domain),
    checkBlacklist(domain),
  ]);

  const postmaster = checkPostmaster();

  const passed = mx.pass && spf.pass && dkim.pass && dmarc.pass && blacklist.pass;

  return {
    passed,
    results: { mx, spf, dkim, dmarc, blacklist, postmaster },
  };
}
