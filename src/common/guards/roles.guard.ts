import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY, IS_PUBLIC_KEY, FEATURE_KEY } from '../decorators';
import { can } from '../rbac/feature-map';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const userRole: OrgRole | undefined = request.organization?.userRole;

    // Novo: @Feature('chave') resolvido contra o FEATURE_MAP.
    const feature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (feature && !can(userRole, feature)) return false;

    // Comportamento anterior: @Roles(...) explícito.
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Chegando aqui, a checagem de @Feature (se houver) já passou.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!userRole) return false;

    return requiredRoles.includes(userRole);
  }
}
