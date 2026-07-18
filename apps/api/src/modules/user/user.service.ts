import bcrypt from 'bcryptjs';
import type { PrismaClient, Prisma, UserRole } from '@coldchain/db';
import type {
  CreateUserRequestType,
  UpdateUserRequestType,
  UserListQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';

const BCRYPT_ROUNDS = 12;

function formatUser(u: {
  id: string;
  email: string;
  name: string;
  nameUrdu: string | null;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    name_urdu: u.nameUrdu,
    role: u.role,
    is_active: u.isActive,
    must_change_password: u.mustChangePassword,
    last_login_at: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    created_at: u.createdAt.toISOString(),
  };
}

export class UserService {
  constructor(private prisma: PrismaClient) {}

  async list(facilityId: string, query: UserListQueryType) {
    const where: Prisma.UserWhereInput = { facilityId };
    if (query.role) where.role = query.role;
    if (typeof query.is_active === 'boolean') where.isActive = query.is_active;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: rows.map(formatUser),
      meta: { total, page: query.page, per_page: query.per_page },
    };
  }

  async getById(facilityId: string, id: string) {
    const user = await this.prisma.user.findFirst({ where: { facilityId, id } });
    if (!user) throw Errors.USER_NOT_FOUND();
    return formatUser(user);
  }

  async create(facilityId: string, body: CreateUserRequestType) {
    const existing = await this.prisma.user.findUnique({
      where: { facilityId_email: { facilityId, email: body.email } },
    });
    if (existing) throw Errors.USER_EMAIL_TAKEN();

    const passwordHash = await bcrypt.hash(body.initial_password, BCRYPT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        facilityId,
        email: body.email,
        name: body.name,
        nameUrdu: body.name_urdu ?? null,
        role: body.role,
        passwordHash,
        mustChangePassword: true,
        isActive: true,
      },
    });
    return formatUser(created);
  }

  async update(facilityId: string, id: string, body: UpdateUserRequestType) {
    const existing = await this.prisma.user.findFirst({ where: { facilityId, id } });
    if (!existing) throw Errors.USER_NOT_FOUND();

    const data: Prisma.UserUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.name_urdu !== undefined) data.nameUrdu = body.name_urdu;
    if (body.role !== undefined) data.role = body.role;
    if (body.is_active !== undefined) {
      data.isActive = body.is_active;
      // Deactivation should revoke all sessions
      if (body.is_active === false) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    }
    const updated = await this.prisma.user.update({ where: { id }, data });
    return formatUser(updated);
  }

  async resetPassword(facilityId: string, id: string, newPassword: string) {
    const existing = await this.prisma.user.findFirst({ where: { facilityId, id } });
    if (!existing) throw Errors.USER_NOT_FOUND();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
    });
    // Force re-auth: revoke all sessions for that user.
    await this.prisma.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return formatUser(updated);
  }

  async changeOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSid?: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.USER_NOT_FOUND();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw Errors.USER_WRONG_PASSWORD();
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    // A changed password should kill any other live session — brings this in
    // line with admin reset and OTP self-reset, which both already do this.
    // Keep the session the request came in on so the caller isn't logged out
    // of their own change-password submission.
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSid ? { id: { not: currentSid } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return formatUser(updated);
  }
}
