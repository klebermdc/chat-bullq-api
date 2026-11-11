import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { HubSalesMirrorAccess } from './hub-sales-mirror.service';

const NOT_ENABLED = 'Relatórios de vendas do HUB não estão habilitados para esta organização.';

/** Usar depois do OrgGuard: depende de `request.organization`. */
@Injectable()
export class HubSalesMirrorGuard implements CanActivate {
  constructor(private readonly access: HubSalesMirrorAccess) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const orgId: string | undefined = context.switchToHttp().getRequest().organization?.id;
    if (!orgId || !(await this.access.isEnabledFor(orgId))) {
      throw new ForbiddenException(NOT_ENABLED);
    }
    return true;
  }
}
