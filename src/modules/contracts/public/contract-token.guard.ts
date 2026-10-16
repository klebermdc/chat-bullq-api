import { BadRequestException, CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';

/** Novos: 43 base64url. Legados do Lovable: 24 hex. */
export const CONTRACT_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function checkContractToken(token: unknown): string {
  if (typeof token !== 'string' || !CONTRACT_TOKEN_RE.test(token)) throw new BadRequestException('Link inválido');
  return token;
}

/**
 * Confere o token da rota antes do corpo ser lido. Guards rodam antes dos
 * interceptors, então o multer (`FileInterceptor`) nem começa a receber o
 * arquivo para link inválido. Não olha JWT: a rota continua `@Public()`.
 */
@Injectable()
export class ContractTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = checkContractToken(req.params?.token);
    const found = await this.prisma.contract.findUnique({ where: { acceptanceToken: token }, select: { id: true } });
    if (!found) throw new NotFoundException('Contrato não encontrado ou link inválido');
    return true;
  }
}
