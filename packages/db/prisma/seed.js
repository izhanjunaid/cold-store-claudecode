"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
// bcryptjs hash of 'admin123' with 10 rounds
// Pre-computed to avoid needing bcryptjs as a seed dependency
const ADMIN_PASSWORD_HASH = '$2a$10$qeCjtZftGtPYgSz2HgOfVekOtcMvmclxPNJH04C9spvcHolg0bnFK';
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding database...');
    // Create default facility
    const facility = await prisma.facility.upsert({
        where: { id: '00000000-0000-0000-0000-000000000001' },
        update: {},
        create: {
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Lahore Cold Store',
            address: 'Multan Road, Near Mandi, Lahore',
            city: 'Lahore',
            phone: '042-35761234',
            settings: {
                weight_dispute_threshold_pct: 2,
                chamber_capacity_warning_pct: 90,
                number_format: 'international',
                gst_enabled: false,
            },
        },
    });
    console.log(`  Facility: ${facility.name} (${facility.id})`);
    // Create OWNER user
    const owner = await prisma.user.upsert({
        where: {
            facilityId_email: {
                facilityId: facility.id,
                email: 'admin@coldchain.pk',
            },
        },
        update: {},
        create: {
            id: '00000000-0000-0000-0000-000000000010',
            facilityId: facility.id,
            email: 'admin@coldchain.pk',
            passwordHash: ADMIN_PASSWORD_HASH,
            name: 'Tariq Ahmad',
            nameUrdu: 'طارق احمد',
            role: 'OWNER',
        },
    });
    console.log(`  Owner: ${owner.name} <${owner.email}> (${owner.role})`);
    // Create additional users for testing
    const users = [
        {
            id: '00000000-0000-0000-0000-000000000011',
            email: 'manager@coldchain.pk',
            name: 'Shahid Iqbal',
            nameUrdu: 'شاہد اقبال',
            role: 'MANAGER',
        },
        {
            id: '00000000-0000-0000-0000-000000000012',
            email: 'accountant@coldchain.pk',
            name: 'Asma Bibi',
            nameUrdu: 'اسماء بی بی',
            role: 'ACCOUNTANT',
        },
        {
            id: '00000000-0000-0000-0000-000000000013',
            email: 'operator@coldchain.pk',
            name: 'Waseem Khan',
            nameUrdu: 'وسیم خان',
            role: 'OPERATOR',
        },
        {
            id: '00000000-0000-0000-0000-000000000014',
            email: 'security@coldchain.pk',
            name: 'Rashid Ali',
            nameUrdu: 'راشد علی',
            role: 'SECURITY',
        },
    ];
    for (const u of users) {
        const user = await prisma.user.upsert({
            where: {
                facilityId_email: {
                    facilityId: facility.id,
                    email: u.email,
                },
            },
            update: {},
            create: {
                id: u.id,
                facilityId: facility.id,
                email: u.email,
                passwordHash: ADMIN_PASSWORD_HASH,
                name: u.name,
                nameUrdu: u.nameUrdu,
                role: u.role,
            },
        });
        console.log(`  ${user.role}: ${user.name} <${user.email}>`);
    }
    console.log('Seeding complete.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map