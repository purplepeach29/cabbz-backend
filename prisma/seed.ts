import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@cabbz.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'changeme123';

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      role: 'ADMIN',
      passwordHash: await bcrypt.hash(adminPassword, 10),
    },
  });
  console.log(`Admin login ready: ${adminEmail} / ${adminPassword}`);

  const locations: Array<{ type: 'VENUE' | 'ACCOMMODATION' | 'AIRPORT' | 'STATION'; name: string; lat: number; lng: number }> = [
    { type: 'VENUE', name: 'Event Venue', lat: 12.9716, lng: 77.5946 },
    { type: 'ACCOMMODATION', name: 'Hotel A', lat: 12.9352, lng: 77.6146 },
    { type: 'ACCOMMODATION', name: 'Hotel B', lat: 12.9611, lng: 77.6387 },
    { type: 'AIRPORT', name: 'City Airport', lat: 13.1986, lng: 77.7066 },
    { type: 'STATION', name: 'Central Railway Station', lat: 12.9779, lng: 77.5722 },
  ];

  for (const loc of locations) {
    const existing = await prisma.location.findFirst({ where: { name: loc.name } });
    if (!existing) await prisma.location.create({ data: loc });
  }
  console.log(`Seeded ${locations.length} reference locations.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
