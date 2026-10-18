import type { NextConfig } from "next";

// Study ids are UUIDs; matching only those keeps /studies/new out of the redirects.
const ID = ':id([0-9a-fA-F-]{36})'

const nextConfig: NextConfig = {
  // Old page addresses from before the menu was grouped into Data / Surveys / Settings.
  // Query strings (e.g. ?participant=) are carried over.
  async redirects() {
    return [
      { source: `/studies/${ID}`, destination: '/?study=:id', permanent: false },
      { source: `/studies/${ID}/processed`, destination: '/studies/:id/data/processed', permanent: false },
      { source: `/studies/${ID}/esm-responses`, destination: '/studies/:id/surveys', permanent: false },
      { source: `/studies/${ID}/esm`, destination: '/studies/:id/surveys/setup', permanent: false },
      { source: `/studies/${ID}/config`, destination: '/studies/:id/settings/sensors', permanent: false },
      { source: `/studies/${ID}/team`, destination: '/studies/:id/settings/team', permanent: false },
      { source: '/admin', destination: '/admin/approvals', permanent: false },
      { source: '/admin/researchers', destination: '/admin/people', permanent: false },
      { source: '/admin/audit', destination: '/admin/activity', permanent: false },
      { source: '/settings', destination: '/settings/account', permanent: false },
    ]
  },
};

export default nextConfig;
