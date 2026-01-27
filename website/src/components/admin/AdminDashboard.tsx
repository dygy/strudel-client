import React, { useState, useEffect } from 'react';
import { ChevronUpDownIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface User {
  user_id: string;
  email: string;
  track_count: number;
  last_active: string;
  created_at?: string;
}

interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AdminDashboardProps {
  initialData?: UsersResponse | null;
}

type SortField = 'email' | 'track_count' | 'last_active';
type SortOrder = 'asc' | 'desc';

export function AdminDashboard({ initialData }: AdminDashboardProps) {
  const [users, setUsers] = useState<User[]>(initialData?.users || []);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialData?.page || 1);
  const [totalPages, setTotalPages] = useState(initialData?.totalPages || 1);
  const [total, setTotal] = useState(initialData?.total || 0);
  const [sortField, setSortField] = useState<SortField>('track_count');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [hasLoadedInitial, setHasLoadedInitial] = useState(!!initialData);
  const limit = 20;

  useEffect(() => {
    // Skip fetching if we have initial data and haven't changed sort/page
    if (hasLoadedInitial && page === 1 && sortField === 'track_count' && sortOrder === 'desc') {
      return;
    }
    fetchUsers();
  }, [page, sortField, sortOrder]);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        sort: sortField,
        order: sortOrder,
      });

      const response = await fetch(`/api/admin/users?${params}`);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Access denied. Admin privileges required.');
        }
        throw new Error('Failed to fetch users');
      }

      const data: UsersResponse = await response.json();
      setUsers(data.users);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setHasLoadedInitial(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronUpDownIcon className="w-4 h-4 text-gray-500 ml-1 inline" />;
    }
    return sortOrder === 'asc'
      ? <ChevronUpIcon className="w-4 h-4 ml-1 inline" />
      : <ChevronDownIcon className="w-4 h-4 ml-1 inline" />;
  };

  // Use fixed format to avoid hydration mismatch (locale-independent)
  // Format: dd.mm.yyyy hh:mm (24-hour, no AM/PM)
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const year = date.getUTCFullYear();
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        <p className="font-bold">Error</p>
        <p>{error}</p>
        <button
          onClick={fetchUsers}
          className="mt-2 bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-gray-400 mt-1">
          {total} users total
        </p>
      </div>

      {/* Users Table */}
      <div className="bg-lineHighlight rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th
                className="px-4 py-3 text-left text-sm font-semibold text-foreground cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('email')}
              >
                Email <SortIcon field="email" />
              </th>
              <th
                className="px-4 py-3 text-left text-sm font-semibold text-foreground cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('track_count')}
              >
                Tracks <SortIcon field="track_count" />
              </th>
              <th
                className="px-4 py-3 text-left text-sm font-semibold text-foreground cursor-pointer hover:bg-gray-600"
                onClick={() => handleSort('last_active')}
              >
                Last Active <SortIcon field="last_active" />
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {users.map((user) => (
              <tr key={user.user_id} className="hover:bg-gray-700/50">
                <td className="px-4 py-3 text-sm text-foreground">
                  {user.email}
                </td>
                <td className="px-4 py-3 text-sm text-foreground">
                  <span className="bg-blue-600 text-white px-2 py-1 rounded text-xs">
                    {user.track_count}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">
                  {formatDate(user.last_active)}
                </td>
                <td className="px-4 py-3 text-sm">
                  <a
                    href={`/${user.user_id}/repl`}
                    className="text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    View REPL
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-700 text-foreground rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
            >
              Previous
            </button>
            {/* Page numbers */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`px-3 py-1 rounded ${
                    page === pageNum
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-foreground hover:bg-gray-600'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 bg-gray-700 text-foreground rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay for subsequent fetches */}
      {loading && users.length > 0 && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center">
          <div className="bg-gray-800 px-6 py-4 rounded-lg">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      )}
    </div>
  );
}
