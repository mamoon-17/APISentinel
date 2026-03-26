import { HttpMethod } from '@/types/api';

export interface SpecEndpoint {
    id: string;
    path: string;
    method: HttpMethod;
    summary: string;
    parameters: { name: string; in: string; type: string; required: boolean }[];
    responseSchema: Record<string, unknown>;
    called: boolean;
    callCount: number;
    lastCalledAt?: Date;
}

export interface SpecDetail {
    specId: string;
    name: string;
    version: string;
    description: string;
    baseUrl: string;
    endpoints: SpecEndpoint[];
}

export const mockSpecDetails: Record<string, SpecDetail> = {
    '1': {
        specId: '1',
        name: 'User Service API',
        version: 'v2.3.1',
        description: 'Handles user management, authentication, and profile operations.',
        baseUrl: 'https://api.example.com/v1',
        endpoints: [
            { id: 'e1', path: '/users', method: 'GET', summary: 'List all users', parameters: [{ name: 'limit', in: 'query', type: 'integer', required: false }, { name: 'offset', in: 'query', type: 'integer', required: false }], responseSchema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } } } }, called: true, callCount: 342 },
            { id: 'e2', path: '/users/{id}', method: 'GET', summary: 'Get user by ID', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, age: { type: 'number' } } }, called: true, callCount: 1204, lastCalledAt: new Date(Date.now() - 1000 * 60 * 2) },
            { id: 'e3', path: '/users', method: 'POST', summary: 'Create a new user', parameters: [], responseSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } }, called: true, callCount: 87 },
            { id: 'e4', path: '/users/{id}', method: 'PUT', summary: 'Update user', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { id: { type: 'string' }, updated: { type: 'boolean' } } }, called: true, callCount: 56 },
            { id: 'e5', path: '/users/{id}', method: 'DELETE', summary: 'Delete user', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { deleted: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'e6', path: '/users/{id}/profile', method: 'GET', summary: 'Get user profile', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { bio: { type: 'string' }, avatar: { type: 'string' } } }, called: true, callCount: 890, lastCalledAt: new Date(Date.now() - 1000 * 60 * 20) },
            { id: 'e7', path: '/users/{id}/profile', method: 'PATCH', summary: 'Update user profile', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { updated: { type: 'boolean' } } }, called: true, callCount: 34, lastCalledAt: new Date(Date.now() - 1000 * 60 * 30) },
            { id: 'e8', path: '/auth/login', method: 'POST', summary: 'Authenticate user', parameters: [], responseSchema: { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'number' } } }, called: true, callCount: 2105, lastCalledAt: new Date(Date.now() - 1000 * 60) },
            { id: 'e9', path: '/auth/logout', method: 'POST', summary: 'Logout user', parameters: [], responseSchema: { type: 'object', properties: { success: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'e10', path: '/auth/refresh', method: 'POST', summary: 'Refresh auth token', parameters: [], responseSchema: { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'number' } } }, called: false, callCount: 0 },
            { id: 'e11', path: '/users/{id}/settings', method: 'GET', summary: 'Get user settings', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { theme: { type: 'string' }, notifications: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'e12', path: '/users/{id}/settings', method: 'PUT', summary: 'Update user settings', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { updated: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'e13', path: '/users/search', method: 'GET', summary: 'Search users', parameters: [{ name: 'q', in: 'query', type: 'string', required: true }], responseSchema: { type: 'array', items: { type: 'object' } }, called: true, callCount: 156 },
            { id: 'e14', path: '/users/{id}/avatar', method: 'POST', summary: 'Upload avatar', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { url: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'e15', path: '/users/{id}/roles', method: 'GET', summary: 'Get user roles', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' } } } }, called: true, callCount: 445 },
            { id: 'e16', path: '/users/{id}/roles', method: 'PUT', summary: 'Assign user roles', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { updated: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'e17', path: '/users/bulk', method: 'POST', summary: 'Bulk create users', parameters: [], responseSchema: { type: 'object', properties: { created: { type: 'number' }, failed: { type: 'number' } } }, called: false, callCount: 0 },
            { id: 'e18', path: '/users/{id}/activity', method: 'GET', summary: 'Get user activity log', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }, { name: 'limit', in: 'query', type: 'integer', required: false }], responseSchema: { type: 'array', items: { type: 'object' } }, called: true, callCount: 78 },
            { id: 'e19', path: '/users/{id}/sessions', method: 'GET', summary: 'List active sessions', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'array', items: { type: 'object' } }, called: false, callCount: 0 },
            { id: 'e20', path: '/users/{id}/sessions', method: 'DELETE', summary: 'Revoke all sessions', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { revoked: { type: 'number' } } }, called: false, callCount: 0 },
            { id: 'e21', path: '/health', method: 'GET', summary: 'Health check', parameters: [], responseSchema: { type: 'object', properties: { status: { type: 'string' } } }, called: true, callCount: 9823 },
            { id: 'e22', path: '/users/export', method: 'GET', summary: 'Export user data', parameters: [{ name: 'format', in: 'query', type: 'string', required: false }], responseSchema: { type: 'object', properties: { downloadUrl: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'e23', path: '/users/{id}/2fa', method: 'POST', summary: 'Enable 2FA', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { secret: { type: 'string' }, qrCode: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'e24', path: '/users/{id}/2fa', method: 'DELETE', summary: 'Disable 2FA', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { disabled: { type: 'boolean' } } }, called: false, callCount: 0 },
        ],
    },
    '2': {
        specId: '2',
        name: 'Order Management API',
        version: 'v1.8.0',
        description: 'Manages orders, payments, and fulfillment workflows.',
        baseUrl: 'https://api.example.com/v1',
        endpoints: [
            { id: 'o1', path: '/orders', method: 'GET', summary: 'List orders', parameters: [{ name: 'status', in: 'query', type: 'string', required: false }], responseSchema: { type: 'array', items: { type: 'object' } }, called: true, callCount: 567 },
            { id: 'o2', path: '/orders', method: 'POST', summary: 'Create order', parameters: [], responseSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' } } }, called: true, callCount: 234 },
            { id: 'o3', path: '/orders/{id}', method: 'GET', summary: 'Get order details', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { id: { type: 'string' }, items: { type: 'array' }, total: { type: 'number' } } }, called: true, callCount: 891 },
            { id: 'o4', path: '/orders/{id}', method: 'PUT', summary: 'Update order', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { updated: { type: 'boolean' } } }, called: false, callCount: 0 },
            { id: 'o5', path: '/orders/{id}/cancel', method: 'POST', summary: 'Cancel order', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { cancelled: { type: 'boolean' } } }, called: true, callCount: 45 },
            { id: 'o6', path: '/orders/{id}/items', method: 'GET', summary: 'Get order items', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'array', items: { type: 'object' } }, called: true, callCount: 678 },
            { id: 'o7', path: '/orders/{id}/shipping', method: 'GET', summary: 'Get shipping info', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { carrier: { type: 'string' }, tracking: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'o8', path: '/orders/{id}/refund', method: 'POST', summary: 'Request refund', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { refundId: { type: 'string' }, amount: { type: 'number' } } }, called: false, callCount: 0 },
            { id: 'o9', path: '/orders/stats', method: 'GET', summary: 'Order statistics', parameters: [], responseSchema: { type: 'object', properties: { total: { type: 'number' }, pending: { type: 'number' } } }, called: true, callCount: 123 },
            { id: 'o10', path: '/payments', method: 'POST', summary: 'Process payment', parameters: [], responseSchema: { type: 'object', properties: { transactionId: { type: 'string' }, status: { type: 'string' } } }, called: true, callCount: 234 },
            { id: 'o11', path: '/payments/{id}', method: 'GET', summary: 'Get payment status', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { status: { type: 'string' }, amount: { type: 'number' } } }, called: true, callCount: 456 },
            { id: 'o12', path: '/payments/{id}/receipt', method: 'GET', summary: 'Download receipt', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { url: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'o13', path: '/inventory', method: 'GET', summary: 'Check inventory', parameters: [{ name: 'productId', in: 'query', type: 'string', required: true }], responseSchema: { type: 'object', properties: { available: { type: 'number' } } }, called: true, callCount: 1230 },
            { id: 'o14', path: '/inventory/reserve', method: 'POST', summary: 'Reserve inventory', parameters: [], responseSchema: { type: 'object', properties: { reservationId: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'o15', path: '/coupons/validate', method: 'POST', summary: 'Validate coupon', parameters: [], responseSchema: { type: 'object', properties: { valid: { type: 'boolean' }, discount: { type: 'number' } } }, called: true, callCount: 89 },
            { id: 'o16', path: '/orders/{id}/notes', method: 'POST', summary: 'Add order note', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { noteId: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'o17', path: '/orders/export', method: 'GET', summary: 'Export orders', parameters: [{ name: 'format', in: 'query', type: 'string', required: false }], responseSchema: { type: 'object', properties: { downloadUrl: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'o18', path: '/webhooks/orders', method: 'POST', summary: 'Register order webhook', parameters: [], responseSchema: { type: 'object', properties: { webhookId: { type: 'string' } } }, called: false, callCount: 0 },
        ],
    },
    '3': {
        specId: '3',
        name: 'Legacy Payment API',
        version: 'v1.0.0',
        description: 'Deprecated payment processing system. Scheduled for decommission.',
        baseUrl: 'https://legacy.example.com/api',
        endpoints: [
            { id: 'l1', path: '/charge', method: 'POST', summary: 'Charge card', parameters: [], responseSchema: { type: 'object', properties: { chargeId: { type: 'string' } } }, called: true, callCount: 12 },
            { id: 'l2', path: '/charge/{id}', method: 'GET', summary: 'Get charge', parameters: [{ name: 'id', in: 'path', type: 'string', required: true }], responseSchema: { type: 'object', properties: { amount: { type: 'number' }, status: { type: 'string' } } }, called: true, callCount: 8 },
            { id: 'l3', path: '/refund', method: 'POST', summary: 'Process refund', parameters: [], responseSchema: { type: 'object', properties: { refundId: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'l4', path: '/balance', method: 'GET', summary: 'Get balance', parameters: [], responseSchema: { type: 'object', properties: { balance: { type: 'number' }, currency: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'l5', path: '/transactions', method: 'GET', summary: 'List transactions', parameters: [{ name: 'limit', in: 'query', type: 'integer', required: false }], responseSchema: { type: 'array', items: { type: 'object' } }, called: false, callCount: 0 },
            { id: 'l6', path: '/webhooks', method: 'POST', summary: 'Register webhook', parameters: [], responseSchema: { type: 'object', properties: { id: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'l7', path: '/config', method: 'GET', summary: 'Get config', parameters: [], responseSchema: { type: 'object', properties: { mode: { type: 'string' } } }, called: false, callCount: 0 },
            { id: 'l8', path: '/health', method: 'GET', summary: 'Health check', parameters: [], responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }, called: true, callCount: 4500 },
        ],
    },
};
