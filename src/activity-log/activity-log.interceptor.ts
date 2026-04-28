import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ActivityLogService } from './activity-log.service';

function decodeJwtPayload(token: string): any {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

const SKIP_PATHS = ['/activity-log/heartbeat', '/auth/login', '/auth/signup'];
const LOG_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Maps URL prefix -> human-readable entity name
const ENTITY_LABELS: Record<string, string> = {
  // Sales
  'invoices':                   'Invoice',
  'sales-return-vouchers':       'Sales Return',
  'recievables':                 'Receivable',

  // Purchases
  'purchase-invoices':           'Purchase Invoice',
  'purchase-invoice-setting':    'Purchase Invoice Setting',
  'purchase-vouchers':           'Purchase Voucher',
  'purchase-return-vouchers':    'Purchase Return',

  // Vouchers
  'payment-vouchers':            'Payment Voucher',
  'payment-voucher-returns':     'Payment Voucher Return',
  'receipt-voucher-returns':     'Receipt Voucher Return',
  'journal-vouchers':            'Journal Voucher',
  'credit-notes':                'Credit Note',
  'credit-note-returns':         'Credit Note Return',
  'debit-notes':                 'Debit Note',
  'debit-note-returns':          'Debit Note Return',

  // Parties
  'customers':                   'Customer',
  'suppliers':                   'Supplier',

  // Inventory
  'items':                       'Item',
  'transfers':                   'Transfer',
  'inventory-count':             'Inventory Count',
  'inventory-transactions':      'Inventory Transaction',
  'sqm-pieces':                  'SQM Piece',
  'requests':                    'Request',

  // Accounting
  'accounts':                    'Account',
  'cash-collections':            'Cash Collection',

  // Setup / config
  'employees':                   'Employee',
  'users':                       'User',
  'settings':                    'Setting',
  'branches':                    'Branch',
  'classifications':             'Classification',
  'categories':                  'Category',
  'groups':                      'Group',
  'currency':                    'Currency',
  'company':                     'Company',
  'real-descriptions':           'Real Description',
  'item-name-descriptions':      'Item Name Description',

  // Other
  'audit':                       'Audit',
  'security-alert':              'Security Alert',
};

const METHOD_VERB: Record<string, string> = {
  POST:   'Created',
  PUT:    'Updated',
  PATCH:  'Updated',
  DELETE: 'Deleted',
};

// Priority-ordered list of document number fields to look for in the response body
const DOC_NUMBER_FIELDS = [
  'invoiceNumber',          // Invoice, Purchase Invoice
  'jvNumber',               // Journal Voucher, Receivable
  'paymentNumber',          // Payment Voucher
  'pvNumber',               // Purchase Voucher
  'pvrNumber',              // Payment Voucher Return
  'cnNumber',               // Credit Note
  'dnNumber',               // Debit Note
  'srNumber',               // Sales Return Voucher
  'prNumber',               // Purchase Return Voucher
  'rvrNumber',              // Receipt Voucher Return
  'accountNumber',          // Account
  'customerAccountNumber',  // Customer
  'supplierAccountNumber',  // Supplier
];

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly activityLog: ActivityLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;

    if (!LOG_METHODS.has(method)) return next.handle();

    const rawPath: string = req.path ?? req.url ?? '';
    // Strip query string and leading /api prefix if present
    const cleanPath = rawPath.split('?')[0].replace(/^\/api/, '');

    if (SKIP_PATHS.some((s) => cleanPath === s)) return next.handle();

    // Use guard-populated user first; fall back to decoding the JWT header
    // so controllers without @UseGuards still get logged.
    let user = req.user;
    if (!user) {
      const authHeader: string = req.headers['authorization'] ?? '';
      if (authHeader.startsWith('Bearer ')) {
        const payload = decodeJwtPayload(authHeader.slice(7));
        if (payload?.sub) {
          user = { userId: payload.sub, username: payload.username, role: payload.role };
        }
      }
    }
    if (!user) return next.handle();

    return next.handle().pipe(
      tap((responseBody) => {
        try {
          const segments = cleanPath.split('/').filter(Boolean);
          const resource = segments[0] ?? 'unknown';
          const entityLabel = ENTITY_LABELS[resource] ?? this.toLabel(resource);

          // Try to get entity ID from response body or URL segment
          const urlId = segments.find((s) => /^\d+$/.test(s));
          const entityId: number | null =
            responseBody?.id != null
              ? Number(responseBody.id)
              : urlId != null
              ? Number(urlId)
              : null;

          // Prefer a human-readable document number over the raw DB id
          const docNumber: string | null =
            DOC_NUMBER_FIELDS.map((f) => responseBody?.[f])
              .find((v) => v != null && v !== '')
              ?? null;

          const verb = METHOD_VERB[method] ?? method;
          const action = `${entityLabel.replace(/ /g, '_').toUpperCase()}_${verb.toUpperCase()}`;

          const rawChanges = responseBody?._changes as any;
          const changesSummary = (() => {
            if (!rawChanges) return '';
            const parts: string[] = [];
            const header = rawChanges.header as Record<string, any> | undefined;
            if (header && Object.keys(header).length)
              parts.push(`${Object.keys(header).length} field${Object.keys(header).length > 1 ? 's' : ''} changed`);
            const items = rawChanges.items as { added?: any[]; removed?: any[]; modified?: any[] } | undefined;
            if (items) {
              if (items.added?.length) parts.push(`${items.added.length} item${items.added.length > 1 ? 's' : ''} added`);
              if (items.removed?.length) parts.push(`${items.removed.length} item${items.removed.length > 1 ? 's' : ''} removed`);
              if (items.modified?.length) parts.push(`${items.modified.length} item${items.modified.length > 1 ? 's' : ''} modified`);
            }
            // fall back to simple header diff (receivables / purchase invoices)
            if (!parts.length && typeof rawChanges === 'object' && !rawChanges.header && !rawChanges.items) {
              const n = Object.keys(rawChanges).length;
              if (n) parts.push(`${n} field${n > 1 ? 's' : ''} changed`);
            }
            return parts.length ? ' — ' + parts.join(', ') : '';
          })();

          const baseDesc = docNumber
            ? `${verb} ${entityLabel} ${docNumber}`
            : entityId
            ? `${verb} ${entityLabel} #${entityId}`
            : `${verb} ${entityLabel}`;
          const description = baseDesc + changesSummary;

          const ip =
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
            req.ip ??
            null;

          const metadata = rawChanges ? { changes: rawChanges } : undefined;

          this.activityLog
            .log({
              userId: Number(user.userId),
              username: user.username,
              action,
              entityType: entityLabel,
              entityId,
              description,
              metadata,
              ipAddress: ip,
            })
            .catch(() => {});
        } catch {
          // never let logging crash the response
        }
      }),
    );
  }

  private toLabel(resource: string): string {
    return resource
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
