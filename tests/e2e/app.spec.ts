import { localDate } from '../../src/lib/format';
import { expect, test, type Page } from '@playwright/test';
import { legacyPlace } from '../../supabase/functions/_shared/osm';
import {
  applyCuisineOverride,
  type CuisineOverride,
} from '../../supabase/functions/_shared/cuisines';
import type { LunchNotification } from '../../src/providers/Notifications';
import type { OfficeOrder, OrderMember, OrderItem } from '../../src/lib/orders';
import type { CookingEvent, Participant, Review } from '../../src/lib/types';
const userId = '00000000-0000-0000-0000-000000000001';
const orgId = '10000000-0000-0000-0000-000000000001';
const user = {
  id: userId,
  email: 'alice@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
  user_metadata: { display_name: 'Alice' },
};
const org = { id: orgId, name: 'Office team', search_area: 'Berlin', created_by: userId };
const otherOrgId = '10000000-0000-0000-0000-000000000002';
const otherOrg = {
  ...org,
  id: otherOrgId,
  name: 'Other team',
  search_area: 'Hamburg',
  latitude: null,
  longitude: null,
  location_label: null,
};
function session() {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: expires, role: 'authenticated' })).toString('base64url')}.test`;
  return {
    access_token: token,
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expires,
    user,
  };
}

type LiveHarness = {
  emit?: (topic: string, organizationId?: string) => void;
  close?: () => void;
  joins?: number;
};
async function realtime(page: Page, harness?: LiveHarness) {
  await page.routeWebSocket('wss://forkcast-test.supabase.co/**', (socket) => {
    if (!harness) {
      socket.close();
      return;
    }
    let channel = '';
    let join: string | null = null;
    let bindings: { id: number; event: string; table: string; filter: string }[] = [];
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      const [joinRef, ref, topic, event, payload] = frame;
      if (event === 'phx_join') {
        harness.joins = (harness.joins ?? 0) + 1;
        channel = topic;
        join = joinRef;
        bindings = payload.config.postgres_changes.map((binding: object, index: number) => ({
          ...binding,
          id: index + 1,
        }));
        socket.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: { postgres_changes: bindings } },
          ]),
        );
      } else if (event === 'heartbeat' || event === 'phx_leave')
        socket.send(
          JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]),
        );
    });
    harness.close = () => socket.close({ code: 1001, reason: 'Simulated reconnect' });
    harness.emit = (subject, organizationId = orgId) => {
      const table =
        subject === 'membership'
          ? 'membership_signals'
          : subject === 'inbox'
            ? 'inbox_signals'
            : 'organization_signals';
      const binding = bindings.find(
        (binding) => binding.table === table && binding.event === 'UPDATE',
      );
      if (!binding) throw new Error('Live subscription has not joined');
      socket.send(
        JSON.stringify([
          join,
          null,
          channel,
          'postgres_changes',
          {
            ids: [binding.id],
            data: {
              schema: 'public',
              table,
              columns: [
                { name: 'organization_id', type: 'uuid' },
                { name: 'recipient_id', type: 'uuid' },
                { name: 'topic', type: 'text' },
                { name: 'revision', type: 'int8' },
              ],
              errors: null,
              type: 'UPDATE',
              commit_timestamp: new Date().toISOString(),
              record: {
                organization_id: organizationId,
                recipient_id: userId,
                user_id: userId,
                topic: subject,
                revision: 2,
              },
              old_record: {},
            },
          },
        ]),
      );
    };
  });
}
async function backend(
  page: Page,
  options: {
    group?: boolean;
    groupOrder?: boolean;
    orderParticipant?: boolean;
    nonOrderOrganizer?: boolean;
    orderStatus?: 'open' | 'closed' | 'placed' | 'arrived';
    orderDeadline?: string;
    office?: boolean;
    organizationRole?: 'admin' | 'member';
    differentCreator?: boolean;
    legacy?: boolean;
    reviewed?: boolean;
    nominated?: boolean;
    shortlistCount?: number;
    stars?: number;
    missingCuisine?: boolean;
    multipleOrganizations?: boolean;
    notifications?: boolean;
    roster?: boolean;
    nonOrganizer?: boolean;
    signupDeadline?: string | null;
    confirmedPayment?: boolean;
    organizerSignups?: boolean;
    favorited?: boolean;
    sourceUpdates?: boolean;
    live?: LiveHarness;
  } = {},
) {
  await realtime(page, options.live);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let group = options.group ?? true;
  let groupRecord = {
    ...org,
    created_by: options.differentCreator ? '00000000-0000-0000-0000-000000000002' : userId,
    latitude: (options.office ? 52.52 : null) as number | null,
    longitude: (options.office ? 13.39 : null) as number | null,
    location_label: (options.office ? 'Berlin office' : null) as string | null,
  };
  const organizationMembers = [
    {
      organization_id: orgId,
      user_id: userId,
      role: options.organizationRole ?? 'admin',
      profiles: { display_name: 'Alice' },
    },
    {
      organization_id: orgId,
      user_id: '00000000-0000-0000-0000-000000000002',
      role: options.organizationRole === 'member' ? 'admin' : 'member',
      profiles: { display_name: 'Bob' },
    },
    ...(options.multipleOrganizations
      ? [
          {
            organization_id: otherOrgId,
            user_id: userId,
            role: 'admin',
            profiles: { display_name: 'Alice' },
          },
        ]
      : []),
  ];
  const reviews: Review[] =
    options.legacy || options.reviewed
      ? [
          {
            id: 'preserved-review',
            organization_id: orgId,
            place_id: options.legacy ? 'old-google-place' : 'osm:node:1',
            author_id: userId,
            stars: options.stars ?? 5,

            comment: 'Original visit',
            created_at: '2026-10-12T10:00:00Z',
            profiles: { id: userId, display_name: 'Alice' },
          },
        ]
      : [];
  const place = {
    id: 'osm:node:1',
    provider: 'osm' as const,
    name: 'Miso Kitchen',
    address: 'Berlin',
    category: options.missingCuisine ? 'Restaurant · Cuisine not listed' : 'Japanese restaurant',
    latitude: 52.52,
    longitude: 13.4,
    types: ['restaurant', options.missingCuisine ? 'cuisine:unknown' : 'cuisine:japanese'],
    hours: [],
    attributions: [],
  };
  const favoriteIds = new Map<string, string[]>([[orgId, options.favorited ? [place.id] : []]]);
  const lunch = new Map<
    string,
    {
      answer: string | null;
      vote: string | null;
      picked: string | null;
      ids: string[];
      nominations: string[];
      fromCooking: boolean;
    }
  >();
  function daily(id: string) {
    if (!lunch.has(id))
      lunch.set(id, {
        answer: null,
        fromCooking: false,
        vote: null,
        picked: null,
        ids:
          id === orgId
            ? options.shortlistCount
              ? Array.from({ length: options.shortlistCount }, (_, i) =>
                  i === 0 ? place.id : 'osm:node:' + (i + 100),
                )
              : options.nominated
                ? [place.id]
                : []
            : [],
        nominations: id === orgId && options.nominated ? [place.id] : [],
      });
    return lunch.get(id)!;
  }
  const orderId = '40000000-0000-0000-0000-000000000001';
  const otherUser = '00000000-0000-0000-0000-000000000002';
  let orderRecord: OfficeOrder | null = options.groupOrder
    ? {
        id: orderId,
        organization_id: orgId,
        organizer_id: options.nonOrderOrganizer ? otherUser : userId,
        order_date: localDate(),
        restaurant: 'Team pizza',
        menu_url: 'https://example.invalid/menu',
        signup_deadline: options.orderDeadline ?? new Date(Date.now() + 3600000).toISOString(),
        delivery_address: 'Berlin office',
        delivery_notes: 'Second floor',
        paypal_handle: 'Alice',
        status: options.orderStatus ?? 'open',
        delivery_fee_cents: 300,
        arrival_at: null,
        version: 1,
        profiles: {
          id: options.nonOrderOrganizer ? otherUser : userId,
          display_name: options.nonOrderOrganizer ? 'Bob' : 'Alice',
        },
      }
    : null;
  let orderMembers: OrderMember[] = options.groupOrder
    ? [
        {
          order_id: orderId,
          user_id: options.orderParticipant ? userId : otherUser,
          ready: true,
          revision: 1,
          total_cents: options.orderStatus === 'placed' ? 1150 : null,
          paid: false,
          payment_confirmed_at: null,
          profiles: {
            id: options.orderParticipant ? userId : otherUser,
            display_name: options.orderParticipant ? 'Alice' : 'Bob',
          },
        },
      ]
    : [];
  let orderItems: OrderItem[] = orderMembers.map((member) => ({
    id: 'item-initial',
    order_id: orderId,
    user_id: member.user_id,
    item_name: 'Margherita',
    quantity: 1,
    unit_cents: 850,
    notes: 'Extra basil',
  }));
  let cuisineOverride: CuisineOverride | undefined;
  let meal: CookingEvent | null = null;
  let participants: Participant[] = [];
  let cookingThread: {
    id: string;
    event_id: string;
    author_id: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    profiles: { id: string; display_name: string };
  }[] = [];
  const eventId = '20000000-0000-0000-0000-000000000001';
  let notices: LunchNotification[] = options.notifications
    ? [
        {
          id: 'new-cooking',
          event_id: eventId,
          kind: 'cooking_scheduled',
          title: 'Team curry',
          meal_date: localDate(),
          actor_name: 'Bob',
          price_cents: 425,
          portions: null,
          read_at: null,
        },
        {
          id: 'unpaid',
          event_id: eventId,
          kind: 'payment_due',
          title: 'Pending lunch',
          meal_date: localDate(),
          actor_name: 'Alice',
          price_cents: 425,
          portions: 1,
          read_at: null,
        },
        {
          id: 'paid',
          event_id: eventId,
          kind: 'payment_received',
          title: 'Hosted lunch',
          meal_date: localDate(),
          actor_name: 'Bob',
          price_cents: 425,
          portions: 2,
          read_at: null,
        },
      ]
    : [];
  if (options.confirmedPayment || options.organizerSignups)
    notices = [
      {
        id: options.confirmedPayment ? 'confirmed' : 'joined',
        event_id: eventId,
        kind: options.confirmedPayment ? 'payment_confirmed' : 'cooking_joined',
        title: 'Team curry',
        meal_date: localDate(),
        actor_name: 'Bob',
        price_cents: 425,
        portions: options.confirmedPayment ? 1 : 2,
        read_at: null,
      },
    ];
  if (options.notifications || options.roster)
    meal = {
      id: eventId,
      organization_id: orgId,
      organizer_id: options.nonOrganizer ? '00000000-0000-0000-0000-000000000002' : userId,
      flags: options.roster ? ['vegan', 'spicy'] : [],
      signup_deadline: options.signupDeadline ?? null,
      meal_date: localDate(),
      title: 'Team curry',
      description: null,
      max_portions: 4,
      price_cents: 425,
      currency: 'EUR',
      paypal_handle: 'LunchCook',
      profiles: { id: userId, display_name: 'Alice' },
    };

  if (options.roster)
    participants = [
      {
        event_id: eventId,
        user_id: userId,
        portions: 1,
        paid: true,
        payment_confirmed_at: options.confirmedPayment ? new Date().toISOString() : null,
        profiles: { id: userId, display_name: 'Alice' },
      },
      {
        event_id: eventId,
        user_id: '00000000-0000-0000-0000-000000000002',
        portions: 2,
        paid: false,
        profiles: { id: '00000000-0000-0000-0000-000000000002', display_name: 'Bob' },
      },
      {
        event_id: eventId,
        user_id: '00000000-0000-0000-0000-000000000003',
        portions: 3,
        paid: true,
        profiles: { id: '00000000-0000-0000-0000-000000000003', display_name: 'Carol' },
      },
    ];
  if (options.groupOrder && options.nonOrderOrganizer && options.orderStatus === 'placed')
    notices.push({
      id: 'order-due',
      event_id: orderId,
      order_id: orderId,
      kind: 'order_payment_due',
      title: 'Team pizza',
      meal_date: localDate(),
      actor_name: 'Bob',
      price_cents: 1150,
      portions: 1,
      read_at: null,
    });
  await page.route('https://forkcast-test.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    let result: unknown;
    if (url.pathname === '/auth/v1/token' || url.pathname === '/auth/v1/verify') result = session();
    else if (url.pathname === '/auth/v1/signup') result = { user, session: null };
    else if (url.pathname === '/auth/v1/logout') {
      await route.fulfill({ status: 204 });
      return;
    } else if (url.pathname === '/rest/v1/organizations')
      result = group
        ? [groupRecord, ...(options.multipleOrganizations ? [otherOrg] : [])].filter((group) =>
            organizationMembers.some(
              (member) => member.user_id === userId && member.organization_id === group.id,
            ),
          )
        : [];
    else if (url.pathname === '/rest/v1/office_orders') {
      const visible =
        orderRecord &&
        url.searchParams.get('organization_id') === `eq.${orderRecord.organization_id}`
          ? [orderRecord]
          : [];
      result = url.searchParams.has('id') ? visible[0] : visible;
    } else if (url.pathname === '/rest/v1/office_order_members') result = orderMembers;
    else if (url.pathname === '/rest/v1/office_order_items') result = orderItems;
    else if (
      url.pathname === '/rest/v1/rpc/create_office_order' ||
      url.pathname === '/rest/v1/rpc/create_office_order_for_member'
    ) {
      const body = route.request().postDataJSON();
      orderRecord = {
        id: orderId,
        organization_id: body.org,
        organizer_id: body.organizer ?? userId,
        order_date: body.meal_date,
        restaurant: body.restaurant_name,
        menu_url: body.menu,
        signup_deadline: body.deadline,
        delivery_address: body.address,
        delivery_notes: body.instructions,
        paypal_handle: body.paypal,
        status: 'open',
        delivery_fee_cents: 0,
        arrival_at: null,
        version: 1,
        profiles: {
          id: body.organizer ?? userId,
          display_name: body.organizer && body.organizer !== userId ? 'Bob' : 'Alice',
        },
      };
      result = orderId;
    } else if (url.pathname === '/rest/v1/rpc/save_office_order_items') {
      const body = route.request().postDataJSON();
      const mine = orderMembers.find((m) => m.user_id === userId);
      if (mine) {
        mine.ready = body.is_ready;
        mine.revision++;
      } else
        orderMembers.push({
          order_id: orderId,
          user_id: userId,
          ready: body.is_ready,
          revision: 1,
          total_cents: null,
          paid: false,
          payment_confirmed_at: null,
          profiles: { id: userId, display_name: 'Alice' },
        });
      orderItems = [
        ...orderItems.filter((i) => i.user_id !== userId),
        ...body.items.map((item: object, i: number) => ({
          ...item,
          id: `order-item-${i}`,
          order_id: orderId,
          user_id: userId,
        })),
      ];
      orderRecord!.version++;
      if (orderRecord?.order_date === localDate()) daily(orgId).answer = 'ordering_in';
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/leave_office_order') {
      orderMembers = orderMembers.filter((m) => m.user_id !== userId);
      orderItems = orderItems.filter((i) => i.user_id !== userId);
      orderRecord!.version++;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/update_office_order') {
      const body = route.request().postDataJSON();
      orderRecord!.status = body.new_status;
      orderRecord!.version++;
      if (body.new_deadline) orderRecord!.signup_deadline = body.new_deadline;
      if (body.eta) orderRecord!.arrival_at = body.eta;
      if (body.new_status === 'placed' && body.fee_cents !== undefined) {
        orderRecord!.delivery_fee_cents = body.fee_cents;
        const count = orderMembers.length;
        orderMembers
          .sort((a, b) => a.user_id.localeCompare(b.user_id))
          .forEach((m, index) => {
            m.total_cents =
              orderItems
                .filter((i) => i.user_id === m.user_id)
                .reduce((sum, i) => sum + i.quantity * i.unit_cents, 0) +
              Math.floor(body.fee_cents / count) +
              (index < body.fee_cents % count ? 1 : 0);
            if (m.user_id === orderRecord!.organizer_id) {
              m.paid = true;
              m.payment_confirmed_at = new Date().toISOString();
            }
          });
      }
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/set_office_order_payment') {
      const body = route.request().postDataJSON();
      orderMembers.find((m) => m.user_id === userId)!.paid = body.is_paid;
      notices = notices.filter((n) => n.id !== 'order-due');
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/confirm_office_order_payment') {
      const body = route.request().postDataJSON();
      const m = orderMembers.find((m) => m.user_id === body.participant)!;
      m.paid = true;
      m.payment_confirmed_at = new Date().toISOString();
      notices = notices.filter((n) => n.id !== 'order-due');
      result = null;
    } else if (url.pathname === '/rest/v1/organization_memberships') {
      result = group
        ? organizationMembers.filter(
            (member) =>
              (!url.searchParams.has('user_id') ||
                url.searchParams.get('user_id') === `eq.${member.user_id}`) &&
              (!url.searchParams.has('organization_id') ||
                url.searchParams.get('organization_id') === `eq.${member.organization_id}`),
          )
        : [];
    } else if (
      url.pathname === '/rest/v1/rpc/remove_organization_member' ||
      url.pathname === '/rest/v1/rpc/leave_organization'
    ) {
      const body = route.request().postDataJSON();
      const index = organizationMembers.findIndex(
        (member) =>
          member.organization_id === body.org && member.user_id === (body.member ?? userId),
      );
      if (index >= 0) organizationMembers.splice(index, 1);
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/set_organization_member_role') {
      const body = route.request().postDataJSON();
      const member = organizationMembers.find(
        (member) => member.organization_id === body.org && member.user_id === body.member,
      );
      if (member) member.role = body.new_role;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/organization_invite')
      result = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    else if (url.pathname === '/rest/v1/place_ratings') {
      const ids = [...new Set(reviews.map((review) => review.place_id))];
      const aggregates = ids.map((id) => {
        const visits = [
          ...new Map(
            reviews
              .filter((review) => review.place_id === id)
              .map((review) => [review.author_id, review]),
          ).values(),
        ];
        return {
          place_id: id,
          organization_id: orgId,
          average: visits.reduce((sum, visit) => sum + visit.stars, 0) / visits.length,
          count: visits.length,
        };
      });
      result = url.searchParams.has('place_id')
        ? (aggregates.find((item) => `eq.${item.place_id}` === url.searchParams.get('place_id')) ??
          null)
        : aggregates.filter(
            (item) => `eq.${item.organization_id}` === url.searchParams.get('organization_id'),
          );
    } else if (url.pathname === '/rest/v1/current_reviews') {
      const latest = [
        ...new Map(
          reviews.map((review) => [review.place_id + ':' + review.author_id, review]),
        ).values(),
      ];
      const matching = latest.filter(
        (review) =>
          `eq.${review.place_id}` === url.searchParams.get('place_id') &&
          (!url.searchParams.has('author_id') ||
            `eq.${review.author_id}` === url.searchParams.get('author_id')),
      );
      result = url.searchParams.has('author_id') ? (matching[0] ?? null) : matching;
    } else if (url.pathname === '/functions/v1/places') {
      const body = route.request().postDataJSON();
      if (body.action === 'locations') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            locations: [{ label: 'Berlin Mitte, Germany', latitude: 52.52, longitude: 13.4 }],
          }),
        });
        return;
      }
      if (body.action === 'details' && body.refresh && options.sourceUpdates) {
        place.types = ['restaurant', 'cuisine:thai'];
        place.category = 'Restaurant · Thai';
      }
      result =
        body.action === 'search'
          ? {
              places: [applyCuisineOverride(place, cuisineOverride)],
              warning: '',
              refreshedAt: '2026-10-12T10:00:00Z',
            }
          : {
              places: body.ids.map((id: string) =>
                id === place.id ? applyCuisineOverride(place, cuisineOverride) : legacyPlace(id),
              ),
              failed: [],
            };
    } else if (url.pathname === '/rest/v1/restaurant_favorites') {
      const selectedOrg = url.searchParams.get('organization_id')?.replace(/^eq\./, '') ?? orgId;
      result = (favoriteIds.get(selectedOrg) ?? []).map((place_id) => ({ place_id }));
    } else if (url.pathname === '/rest/v1/rpc/set_restaurant_favorite') {
      const body = route.request().postDataJSON();
      const ids = new Set(favoriteIds.get(body.org) ?? []);
      if (body.bookmarked) ids.add(body.osm_place_id);
      else ids.delete(body.osm_place_id);
      favoriteIds.set(body.org, [...ids].sort());
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/notification_inbox') {
      const visible = route.request().postDataJSON().org === orgId ? notices : [];
      result = {
        unread: visible.filter((n) => !n.read_at).length,
        items: visible.map((n) => ({ ...n, signup_deadline: meal?.signup_deadline ?? null })),
      };
    } else if (url.pathname === '/rest/v1/rpc/update_notification') {
      const body = route.request().postDataJSON();
      if (body.dismiss) notices = notices.filter((n) => n.id !== body.notice);
      else {
        const n = notices.find((n) => n.id === body.notice);
        if (n && n.kind !== 'payment_due' && n.kind !== 'order_payment_due')
          n.read_at = new Date().toISOString();
      }
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/read_all_notifications') {
      notices.forEach((n) => {
        if (n.kind !== 'payment_due' && n.kind !== 'order_payment_due')
          n.read_at = new Date().toISOString();
      });
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/join_notification_lunch') {
      participants = [
        {
          event_id: eventId,
          user_id: userId,
          portions: 1,
          paid: false,
          profiles: { id: userId, display_name: 'Alice' },
        },
      ];
      notices = notices.filter((n) => n.id !== route.request().postDataJSON().notice);
      if (meal?.meal_date === localDate()) {
        const today = daily(orgId);
        today.answer = 'brought_food';
        today.fromCooking = true;
        today.vote = null;
      }
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/lunch_overview') {
      const id = route.request().postDataJSON().org;
      const today = daily(id);
      result = {
        day: localDate(),
        mine: today.answer,
        myVote: today.vote,
        joinedCooking: !!participants.length && meal?.meal_date === localDate(),
        pickedPlaceId: today.picked,
        counts: {
          going_out: today.answer === 'going_out' ? 1 : 0,
          brought_food: today.answer === 'brought_food' ? 1 : 0,
          no_lunch: today.answer === 'no_lunch' ? 1 : 0,
          ordering_in: today.answer === 'ordering_in' ? 1 : 0,
          unanswered: today.answer ? 0 : 1,
        },
        options: today.ids.map((id) => ({
          place:
            id === place.id ? place : { ...place, id, name: 'Lunch spot ' + id.split(':').at(-1) },
          nominated: true,
          override: cuisineOverride ?? null,
          votes: today.vote === id ? 1 : 0,
        })),
      };
    } else if (url.pathname === '/rest/v1/rpc/set_lunch_response') {
      const body = route.request().postDataJSON();
      const today = daily(body.org);
      today.answer = body.answer;
      today.fromCooking = false;
      if (body.answer !== 'going_out') today.vote = null;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/vote_lunch_place') {
      const body = route.request().postDataJSON();
      daily(body.org).vote = body.osm_place_id;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/suggest_lunch_place') {
      const body = route.request().postDataJSON();
      const today = daily(body.org);
      if (!today.ids.includes(body.osm_place_id)) today.ids.push(body.osm_place_id);
      if (!today.nominations.includes(body.osm_place_id)) today.nominations.push(body.osm_place_id);
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/spin_lunch_wheel') {
      const today = daily(route.request().postDataJSON().org);
      today.picked = today.ids[0] ?? route.request().postDataJSON().candidate_ids?.[0] ?? null;
      if (today.picked && !today.ids.includes(today.picked)) today.ids.push(today.picked);
      result = today.picked;
    } else if (url.pathname === '/rest/v1/rpc/set_place_cuisines') {
      const body = route.request().postDataJSON();
      cuisineOverride = body.cuisines.length
        ? { cuisines: body.cuisines, updatedAt: '2026-10-12T12:00:00Z' }
        : undefined;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/link_legacy_place') {
      const body = route.request().postDataJSON();
      reviews.forEach((review) => {
        if (review.place_id === body.legacy_id) review.place_id = body.osm_place_id;
      });
      result = 1;
    } else if (url.pathname === '/rest/v1/rpc/save_review') {
      const body = route.request().postDataJSON();
      reviews.push({
        id: 'review-one',
        organization_id: orgId,
        place_id: body.osm_place_id,
        author_id: userId,
        stars: body.rating,

        comment: body.review_comment,
        created_at: '2026-10-12T10:00:00Z',
        profiles: { id: userId, display_name: 'Alice' },
      });
      result = 'review-one';
    } else if (url.pathname === '/rest/v1/rpc/create_cooking_event') {
      const body = route.request().postDataJSON();
      meal = {
        id: eventId,
        organization_id: orgId,
        organizer_id: userId,
        meal_date: body.event_date,
        flags: body.meal_flags ?? [],
        signup_deadline: body.signup_until ?? null,
        title: body.meal_title,
        description: body.meal_description,
        max_portions: body.portion_limit,
        price_cents: body.portion_price,
        paypal_handle: body.paypal,
        currency: 'EUR',
        profiles: { id: userId, display_name: 'Alice' },
      };
      result = eventId;
    } else if (url.pathname === '/rest/v1/rpc/confirm_cooking_payment') {
      const body = route.request().postDataJSON();
      const target = participants.find((p) => p.user_id === body.participant)!;
      target.paid = true;
      target.payment_confirmed_at ??= new Date().toISOString();
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/set_cooking_signup_deadline') {
      const body = route.request().postDataJSON();
      meal!.signup_deadline = body.close_now ? new Date().toISOString() : body.deadline;
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/set_cooking_flags') {
      meal!.flags = route.request().postDataJSON().meal_flags;
      result = null;
    } else if (url.pathname === '/rest/v1/cooking_events')
      result = url.searchParams.has('id') ? meal : meal ? [meal] : [];
    else if (url.pathname === '/rest/v1/cooking_event_participants') result = participants;
    else if (url.pathname === '/rest/v1/cooking_comments') {
      const start = Number(
        route.request().headers()['range']?.split('-')[0] ?? url.searchParams.get('offset') ?? 0,
      );
      const limit = Number(url.searchParams.get('limit') ?? 21);
      result = [...cookingThread].reverse().slice(start, start + limit);
    } else if (url.pathname === '/rest/v1/rpc/save_cooking_comment') {
      const body = route.request().postDataJSON();
      if (body.comment_id) {
        const comment = cookingThread.find((c) => c.id === body.comment_id)!;
        comment.body = body.comment_body;
        comment.edited_at = new Date().toISOString();
        result = comment.id;
      } else {
        result = `comment-${cookingThread.length}`;
        cookingThread.push({
          id: result as string,
          event_id: body.event,
          author_id: userId,
          body: body.comment_body,
          created_at: new Date().toISOString(),
          edited_at: null,
          profiles: { id: userId, display_name: 'Alice' },
        });
      }
    } else if (url.pathname === '/rest/v1/rpc/delete_cooking_comment') {
      cookingThread = cookingThread.filter(
        (c) => c.id !== route.request().postDataJSON().comment_id,
      );
      result = null;
    } else if (url.pathname === '/rest/v1/event_images') result = [];
    else if (url.pathname === '/rest/v1/rpc/set_portions') {
      const quantity = route.request().postDataJSON().quantity;
      const wasJoined = !!participants.length;
      participants = quantity
        ? [
            {
              event_id: eventId,
              user_id: userId,
              portions: quantity,
              paid: false,
              profiles: { id: userId, display_name: 'Alice' },
            },
          ]
        : [];
      result = null;
      if (meal?.meal_date === localDate()) {
        const today = daily(orgId);
        if (!wasJoined && participants.length) {
          today.fromCooking = today.answer === 'brought_food' && !today.fromCooking ? false : true;
          today.answer = 'brought_food';
          today.vote = null;
        } else if (wasJoined && !participants.length && today.fromCooking) {
          today.answer = null;
          today.fromCooking = false;
        }
      }
    } else if (url.pathname === '/rest/v1/rpc/mark_payment') {
      participants[0].paid = route.request().postDataJSON().is_paid;
      if (participants[0].paid)
        notices = notices.filter((n) => n.kind !== 'payment_due' && n.kind !== 'order_payment_due');
      result = null;
    } else if (url.pathname === '/rest/v1/rpc/create_organization') {
      group = true;
      const body = route.request().postDataJSON();
      groupRecord = {
        ...groupRecord,
        name: body.org_name,
        search_area: body.area,
        latitude: body.office_latitude,
        longitude: body.office_longitude,
        location_label: body.office_label,
      };
      result = orgId;
    } else if (url.pathname === '/rest/v1/rpc/set_organization_location') {
      const body = route.request().postDataJSON();
      groupRecord = {
        ...groupRecord,
        search_area: body.area,
        latitude: body.office_latitude,
        longitude: body.office_longitude,
        location_label: body.office_label,
      };
      result = null;
    } else throw new Error(`Unexpected request: ${route.request().method()} ${url.pathname}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#E7EFE5' } },
        ],
      }),
    }),
  );
  return errors;
}
async function signIn(page: Page, tab: 'Places' | 'Overview' = 'Places') {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page
      .getByRole('tab', { name: /Overview/ })
      .or(page.getByText('Pull up a chair.', { exact: true })),
  ).toBeVisible();
  if (tab === 'Places' && (await page.getByRole('tab', { name: /Places/ }).count()))
    await page.getByRole('tab', { name: /Places/ }).click();
}

test('sign in persists across reload and sign out removes the session', async ({ page }) => {
  const errors = await backend(page);
  await signIn(page);
  await expect(page.getByRole('radio', { name: 'Map view', exact: true })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: /Map/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.getByRole('radio', { name: 'Map view', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('sign up and verify email with an OTP', async ({ page }) => {
  const errors = await backend(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create account' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Alice');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByText('Verify your email', { exact: true })).toBeVisible();
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify & sign in' }).click();
  await expect(page.getByText("What's for lunch today?", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Google creates a session through PKCE and keeps the pending invite across redirect', async ({
  page,
}) => {
  const errors = await backend(page, { group: false });
  const invite = 'abcdef0123456789abcdef0123456789';
  await page.goto('/');
  await page.evaluate((value) => localStorage.setItem('forkcast.pending-invite', value), invite);
  await page.reload();
  await page.route('https://forkcast-test.supabase.co/auth/v1/authorize**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    const callback = new URL(url.searchParams.get('redirect_to')!);
    callback.searchParams.set('code', 'google-test-code');
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });
  const token = page.waitForRequest('**/auth/v1/token?grant_type=pkce');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  expect((await token).postDataJSON()).toMatchObject({ auth_code: 'google-test-code' });
  expect((await token).postDataJSON().code_verifier).toBeTruthy();
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Invite code or Forkcast link')).toHaveValue(invite);
  await expect(page).toHaveURL('http://127.0.0.1:8088/');
  await page.reload();
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Google denial shows a recoverable error and never exchanges a code', async ({ page }) => {
  const errors = await backend(page);
  const tokens: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/v1/token')) tokens.push(request.url());
  });
  await page.goto('/?error=access_denied&error_description=private-provider-message');
  await expect(
    page.getByText('Google sign-in was cancelled. Please try again.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  expect(tokens).toEqual([]);
  await expect(page).toHaveURL('http://127.0.0.1:8088/');
  expect(errors).toEqual([]);
});

test('an expired Google code leaves the user signed out and can be retried', async ({ page }) => {
  const errors = await backend(page);
  await page.route('https://forkcast-test.supabase.co/auth/v1/token**', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Expired code' }),
    }),
  );
  await page.goto('/?code=expired-google-code');
  await expect(
    page.getByText('Google sign-in expired or could not be completed. Please try again.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:8088/');
  expect(errors).toEqual([]);
});

test('create a first group and reach the empty discovery and cooking screens', async ({ page }) => {
  const errors = await backend(page, { group: false });
  await signIn(page);
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  await page.getByLabel('Organization name', { exact: true }).fill('Office team');
  await page.getByLabel('Organization address or area', { exact: true }).fill('Berlin');
  await page.getByRole('button', { name: 'Find organization location', exact: true }).click();
  await page.getByRole('button', { name: 'Select Berlin Mitte, Germany', exact: true }).click();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  const request = page.waitForRequest('**/rpc/create_organization');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    org_name: 'Office team',
    area: 'Berlin Mitte, Germany',
    office_latitude: 52.52,
    office_longitude: 13.4,
    office_label: 'Berlin Mitte, Germany',
  });
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.getByText('Put your first spot on the map')).toBeVisible();
  await expect(page.locator('[aria-label="Organization location: Office team"]')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.locator('[aria-label="Organization location: Office team"]')).toBeVisible();
  await page.getByRole('tab', { name: /Cooking/ }).click();
  await page.getByRole('button', { name: 'Host an office lunch' }).click();
  await expect(page.getByLabel('Price per portion (EUR)')).toBeVisible();
  await expect(page.getByLabel('Date (YYYY-MM-DD)')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  expect(errors).toEqual([]);
});

test('share a review then edit the same opinion with prefilled values', async ({ page }) => {
  const errors = await backend(page);
  await signIn(page);
  await page.getByRole('button', { name: 'Find a place & add a review' }).click();
  await page.getByLabel('Restaurant or cuisine').fill('Miso');
  await page.getByRole('button', { name: 'Search lunch spots' }).click();
  await page.getByRole('button', { name: 'View place & review' }).click();
  await expect(page.getByText('Be the first to share')).toBeVisible();
  await expect(page.getByText('Would you recommend it?', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '4 ★', exact: true }).click();
  await page.getByLabel('Your thoughts (optional)').fill('A lovely lunch.');
  const request = page.waitForRequest('**/rpc/save_review');
  await page.getByRole('button', { name: 'Share review' }).click();
  expect((await request).postDataJSON()).toMatchObject({
    org: orgId,
    osm_place_id: 'osm:node:1',
    rating: 4,
    review_comment: 'A lovely lunch.',
  });
  expect((await request).postDataJSON()).not.toHaveProperty('vote');
  await expect(page.getByText('A lovely lunch.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your thoughts (optional)')).toHaveValue('A lovely lunch.');
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '2 ★', exact: true }).click();
  await page.getByLabel('Your thoughts (optional)').fill('Different experience this time.');
  const edit = page.waitForRequest('**/rpc/save_review');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await edit).postDataJSON()).toMatchObject({
    rating: 2,
    review_comment: 'Different experience this time.',
  });
  await expect(page.getByText('Different experience this time.', { exact: true })).toBeVisible();
  await expect(page.getByText('A lovely lunch.', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cooking signup selects office attendance and leaving preserves later manual choices', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, nominated: true });
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Host an office lunch', exact: true }).click();
  await page.getByLabel('Meal name (optional)').fill('Office noodles');
  await page.getByRole('button', { name: 'Create lunch', exact: true }).click();
  await page.getByRole('button', { name: 'Save my portions', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: "I'm eating in the office", exact: true }),
  ).toBeChecked();
  await expect(page.getByText('Joined office cooking', { exact: true })).toBeVisible();
  await expect(page.getByText('0 votes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await page.getByRole('button', { name: 'Leave lunch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm: leave this lunch', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: "I'm eating in the office", exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await page.getByRole('button', { name: 'Save my portions', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }).click();
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await page.getByRole('button', { name: 'Leave lunch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm: leave this lunch', exact: true }).click();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

test('organizers see the full payment roster and can edit predefined meal tags', async ({
  page,
}) => {
  const errors = await backend(page, { roster: true });
  await signIn(page, 'Overview');
  await expect(
    page.getByText('Vegan', { exact: true }).and(page.locator(':not([aria-hidden="true"] *)')),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await expect(page.getByText('Participants · 3', { exact: true })).toBeVisible();
  await expect(page.getByText('Bob', { exact: true })).toBeVisible();
  await expect(page.getByText('Carol', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid · 2 · €17.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Awaiting payment · 1 · €8.50', { exact: true })).toBeVisible();
  await expect(page.getByText('Unpaid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^At the table/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit meal tags', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Vegan', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Vegan', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Vegetarian', exact: true }).click();
  const request = page.waitForRequest('**/rpc/set_cooking_flags');
  await page.getByRole('button', { name: 'Save meal tags', exact: true }).click();
  expect((await request).postDataJSON().meal_flags).toEqual(['spicy', 'vegetarian']);
  await expect(page.getByText('Vegetarian', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Vegan', { exact: true }).and(page.locator(':not([aria-hidden="true"] *)')),
  ).toHaveCount(0);
  await page.screenshot({ path: '/tmp/forkcast-organizer-roster.png', fullPage: true });
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(page.getByText('Vegetarian', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('members see meal tags but cannot edit them and participants stay expandable', async ({
  page,
}) => {
  const errors = await backend(page, { roster: true, nonOrganizer: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await expect(
    page.getByText('Vegan', { exact: true }).and(page.locator(':not([aria-hidden="true"] *)')),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit meal tags', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'At the table · 3', exact: true }).click();
  await expect(page.getByText('Carol', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('create a paid lunch, reserve portions, mark payment and leave', async ({ page }) => {
  const errors = await backend(page);
  await signIn(page);
  await page.getByRole('tab', { name: /Cooking/ }).click();
  await page.getByRole('button', { name: 'Host an office lunch' }).click();
  await page.getByLabel('Meal name (optional)').fill('Lentil curry');
  await page.getByRole('checkbox', { name: 'Vegan', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Spicy', exact: true }).click();
  await page.getByRole('button', { name: 'Set a limit', exact: true }).click();
  await page.getByLabel('Maximum portions').fill('3');
  await page.getByLabel('Price per portion (EUR)').fill('4.29');
  await page.getByLabel('PayPal.me username or link (required for paid lunches)').fill('LunchCook');
  const creating = page.waitForRequest('**/rpc/create_cooking_event');
  await page.getByRole('button', { name: 'Create lunch', exact: true }).click();
  expect((await creating).postDataJSON()).toMatchObject({
    org: orgId,
    portion_limit: 3,
    portion_price: 429,
    meal_flags: ['vegan', 'spicy'],
    paypal: 'LunchCook',
  });
  await page.getByLabel('Your portions').fill('2');
  await page.getByRole('button', { name: 'Save my portions' }).click();
  await expect(page.getByText('1 of 3 portions remaining', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pay .*8.58.* with PayPal/ })).toBeVisible();
  await page.getByRole('button', { name: 'I have paid', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Marked paid — undo' })).toBeVisible();
  await page.getByRole('button', { name: 'Leave lunch', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm: leave this lunch', exact: true }).click();
  await expect(page.getByText('3 of 3 portions remaining', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('previous review history can be matched to an OSM place', async ({ page }) => {
  const errors = await backend(page, { legacy: true, differentCreator: true });
  await signIn(page);
  await expect(page.getByText('0 reviewed spots on the map', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Read reviews', exact: true }).click();
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Match to an OSM place' }).click();
  await page.getByLabel('Restaurant or cuisine').fill('Miso');
  await page.getByRole('button', { name: 'Search lunch spots' }).click();
  await page.getByRole('button', { name: 'Match this place' }).click();
  const request = page.waitForRequest('**/rpc/link_legacy_place');
  await page.getByRole('button', { name: 'Confirm match & keep reviews' }).click();
  expect((await request).postDataJSON()).toEqual({
    org: orgId,
    legacy_id: 'old-google-place',
    osm_place_id: 'osm:node:1',
  });
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  await expect(
    page
      .getByText('Miso Kitchen', { exact: true })
      .and(page.locator(':not([aria-hidden="true"] *)')),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('interactive map shows organization ratings and selecting a pin opens reviews', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await page.route('https://tiles.openfreemap.org/styles/positron', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#E7EFE5' } },
        ],
      }),
    }),
  );
  await signIn(page);
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Places/ })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page
      .getByText('Miso Kitchen', { exact: true })
      .and(page.locator(':not([aria-hidden="true"] *)')),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Map', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Map view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars' }).click();
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('creator can set and fine-tune an existing organization location; filters keep its pin', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, stars: 4 });
  await signIn(page);
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Set organization location', exact: true }).click();
  await page.getByLabel('Organization address or area', { exact: true }).first().fill('Berlin');
  await page
    .getByRole('button', { name: 'Find organization location', exact: true })
    .first()
    .click();
  await page.getByRole('button', { name: 'Select Berlin Mitte, Germany', exact: true }).click();
  const canvas = page.locator('[aria-label="Choose organization location on map"] canvas');
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 50, y: 70 } });
  const request = page.waitForRequest('**/rpc/set_organization_location');
  await page.getByRole('button', { name: 'Save organization location', exact: true }).click();
  const saved = (await request).postDataJSON();
  expect(saved.office_latitude).not.toBe(52.52);
  expect(saved.office_longitude).not.toBe(13.4);
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.locator('[aria-label="Organization location: Office team"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Miso Kitchen, 4.0 stars' })).toBeVisible();
  await page.getByRole('button', { name: 'Rating: Any rating', exact: true }).click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Miso Kitchen, 4.0 stars' })).toHaveCount(0);
  await expect(page.locator('[aria-label="Organization location: Office team"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('organization settings group actions and preserve collapsed form drafts', async ({ page }) => {
  const errors = await backend(page, { multipleOrganizations: true });
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await expect(page.getByText('Your account', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Organization name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Invite code or Forkcast link', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get invite', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/forkcast-organization-clean.png', fullPage: true });
  const join = page.getByRole('button', { name: 'Join a group', exact: true });
  await join.click();
  await page.getByLabel('Invite code or Forkcast link', { exact: true }).fill('draft-code');
  await join.click();
  await expect(join).toHaveAttribute('aria-expanded', 'false');
  await join.click();
  await expect(page.getByLabel('Invite code or Forkcast link', { exact: true })).toHaveValue(
    'draft-code',
  );
  await join.click();
  await page.getByRole('button', { name: 'Invite colleagues', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get invite', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Your organizations', exact: true }).click();
  await page.getByRole('button', { name: 'Other team', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Switch organization. Current: Other team', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get invite', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('creating a group requires selecting a location', async ({ page }) => {
  const errors = await backend(page, { group: false });
  await signIn(page);
  await page.getByLabel('Organization name', { exact: true }).fill('Office team');
  await page.getByLabel('Organization address or area', { exact: true }).fill('Berlin');
  await page.getByRole('button', { name: 'Create organization', exact: true }).click();
  await expect(
    page.getByText('Enter a group name and select its location.', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('missing cuisine can be edited for the team, used in filters, reset, and opened in OSM editor', async ({
  page,
  context,
}) => {
  const errors = await backend(page, { reviewed: true, missingCuisine: true });
  await context.route('https://www.openstreetmap.org/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<html><body>OSM editor test</body></html>' }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }).click();
  await page.getByRole('button', { name: 'Add cuisine for your team', exact: true }).click();
  await page.getByRole('button', { name: 'Save cuisine', exact: true }).click();
  await expect(page.getByText(/Select 1–8 cuisines/)).toBeVisible();
  await page.getByLabel('Search OSM cuisines', { exact: true }).fill('Italian');
  await page.getByRole('checkbox', { name: 'Italian', exact: true }).click();
  await page.getByLabel('Search OSM cuisines', { exact: true }).fill('pizza');
  await page.getByRole('checkbox', { name: 'Pizza', exact: true }).press('Space');
  const request = page.waitForRequest('**/rpc/set_place_cuisines');
  await page.getByRole('button', { name: 'Save cuisine', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    org: orgId,
    osm_place_id: 'osm:node:1',
    cuisines: ['italian', 'pizza'],
  });
  await expect(
    page.getByText('Cuisine saved for your organization.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Cuisine supplied by your team/)).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Edit on OpenStreetMap', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForURL('https://www.openstreetmap.org/edit**');
  const editUrl = new URL(popup.url());
  expect(editUrl.searchParams.get('node')).toBe('1');
  expect(editUrl.searchParams.get('editor')).toBe('id');
  await popup.close();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'Cuisine: All cuisines', exact: true }).click();
  await page.getByRole('radio', { name: 'Italian', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await page.getByRole('button', { name: 'Cuisine: All cuisines', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Italian', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close filter options', exact: true }).click();
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }).click();
  await page.getByRole('button', { name: 'Use OpenStreetMap cuisine', exact: true }).click();
  await expect(page.getByText('Using OpenStreetMap cuisine again.', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add cuisine for your team', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('system appearance switches live without losing typed credentials', async ({ page }) => {
  const errors = await backend(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const primary = page.getByRole('button', { name: 'Continue with Google', exact: true });
  await expect(primary).toHaveCSS('background-color', 'rgb(255, 163, 71)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(17, 20, 25)');
  await expect(page.getByLabel('Email', { exact: true })).toHaveCSS(
    'background-color',
    'rgb(37, 43, 52)',
  );
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(primary).toHaveCSS('background-color', 'rgb(255, 138, 36)');
  await expect(primary.getByText('Continue with Google', { exact: true })).toHaveCSS(
    'color',
    'rgb(35, 38, 43)',
  );
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('alice@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('password123');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(primary).toHaveCSS('background-color', 'rgb(255, 163, 71)');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.getByRole('radio', { name: 'Map view', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Find a place & add a review', exact: true }),
  ).toHaveCSS('background-color', 'rgb(48, 39, 31)');
  expect(errors).toEqual([]);
});

test('system dark mode changes the map style and marker colors while preserving the session', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page);
  const marker = page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars' });
  await expect(marker).toHaveCSS('background-color', 'rgb(255, 138, 36)');
  const darkStyle = page.waitForRequest('https://tiles.openfreemap.org/styles/dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await darkStyle;
  await expect(marker).toHaveCSS('background-color', 'rgb(255, 163, 71)');
  await expect(marker).toHaveCSS('color', 'rgb(35, 38, 43)');
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(marker).toHaveCSS('background-color', 'rgb(255, 163, 71)');
  await marker.click();
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('combined Places views share compact filters and data select, dismiss and reset options on a narrow dark-mode screen', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, stars: 4 });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  let reviewLoads = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/rest/v1/place_ratings') reviewLoads++;
  });
  await signIn(page);
  const cuisine = page.getByRole('button', { name: 'Cuisine: All cuisines', exact: true });
  const rating = page.getByRole('button', { name: 'Rating: Any rating', exact: true });
  await expect(page.getByRole('button', { name: /^Votes:/ })).toHaveCount(0);
  const boxes = await Promise.all([cuisine.boundingBox(), rating.boundingBox()]);
  expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBe(1);
  expect(boxes[0]!.height).toBeLessThan(70);
  await cuisine.click();
  const chooser = page.getByRole('dialog', { name: 'Cuisine filter', exact: true });
  await expect(chooser).toBeVisible();
  await expect(chooser).toHaveCSS('background-color', 'rgb(28, 32, 39)');
  await page.getByRole('radio', { name: 'Japanese', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cuisine: Japanese', exact: true })).toBeVisible();
  await rating.click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).press('Space');
  await expect(page.getByRole('button', { name: 'Rating: 4.5+ stars', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cuisine: Japanese', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Cuisine filter', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cuisine: Japanese', exact: true })).toBeVisible();

  await expect(page.getByText('No matching spots', { exact: true })).toBeVisible();
  const loadsBeforeSwitch = reviewLoads;
  await page.getByRole('radio', { name: 'List view', exact: true }).press('Space');
  await expect(page.getByRole('radio', { name: 'List view', exact: true })).toBeChecked();
  await expect(page.getByText('No spots match', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cuisine: Japanese', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rating: 4.5+ stars', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Map view', exact: true }).click();
  await expect(page.getByText('No matching spots', { exact: true })).toBeVisible();
  expect(reviewLoads).toBe(loadsBeforeSwitch);

  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(cuisine).toBeVisible();
  await expect(rating).toBeVisible();
  await expect(page.getByRole('button', { name: 'Miso Kitchen, 4.0 stars' })).toBeVisible();
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Cuisine: All cuisines', exact: true }).click();
  await page.getByRole('radio', { name: 'Japanese', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Map view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cuisine: Japanese', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Miso Kitchen, 4.0 stars' })).toBeVisible();
  expect(reviewLoads).toBe(loadsBeforeSwitch);
  expect(errors).toEqual([]);
});

test('OSM cuisine picker retains selections, canonical tags and a validated custom fallback', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cuisine for your team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Japanese', exact: true })).toBeVisible();
  await page.getByLabel('Search OSM cuisines', { exact: true }).fill('tex mex');
  await page.getByRole('checkbox', { name: 'Tex-Mex', exact: true }).click();
  await page.getByLabel('Search OSM cuisines', { exact: true }).fill('coffee');
  await page.getByRole('checkbox', { name: 'Coffee Shop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Tex-Mex', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add a custom cuisine', exact: true }).click();
  await page.getByLabel('Custom cuisine', { exact: true }).fill('<script>');
  await page.getByRole('button', { name: 'Add custom tag', exact: true }).click();
  await expect(page.getByText(/Select 1–8 cuisines/)).toBeVisible();
  await page.getByLabel('Custom cuisine', { exact: true }).fill('Office noodles');
  await page.getByRole('button', { name: 'Add custom tag', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Office noodles', exact: true }),
  ).toBeVisible();
  const saved = page.waitForRequest('**/rpc/set_place_cuisines');
  await page.getByRole('button', { name: 'Save cuisine', exact: true }).click();
  expect((await saved).postDataJSON().cuisines).toEqual([
    'japanese',
    'tex-mex',
    'coffee_shop',
    'office_noodles',
  ]);
  await page.getByRole('button', { name: 'Edit cuisine for your team', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove Office noodles', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove Japanese', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel cuisine edit', exact: true }).click();
  await page.getByRole('button', { name: 'Edit cuisine for your team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Japanese', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('system language changes live, preserves credentials and falls back to English', async ({
  page,
}) => {
  const errors = await backend(page);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('alice@example.test');
  await page.getByLabel('Password', { exact: true }).fill('password123');
  const changeLanguage = async (languages: string[]) =>
    page.evaluate((languages) => {
      Object.defineProperty(navigator, 'languages', { configurable: true, get: () => languages });
      window.dispatchEvent(new Event('languagechange'));
    }, languages);
  await changeLanguage(['de-DE']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(
    page.getByRole('button', { name: 'Mit Google fortfahren', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('E-Mail', { exact: true })).toHaveValue('alice@example.test');
  await expect(page.getByLabel('Passwort', { exact: true })).toHaveValue('password123');
  await changeLanguage(['fr-FR']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('alice@example.test');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(page.getByRole('radio', { name: 'Map view', exact: true })).toBeVisible();
  await changeLanguage(['de-AT']);
  await expect(page.getByRole('radio', { name: 'Kartenansicht', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Dein Team/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German device language', () => {
  test.use({ locale: 'de-DE' });
  async function signInGerman(page: Page) {
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(
      page
        .getByRole('tab', { name: /Übersicht/ })
        .or(page.getByText('Komm an den Tisch.', { exact: true })),
    ).toBeVisible();
    if (await page.getByRole('tab', { name: /Restaurants/ }).count())
      await page.getByRole('tab', { name: /Restaurants/ }).click();
  }
  test('German validation and organization setup preserve names, addresses and map pins', async ({
    page,
  }) => {
    const errors = await backend(page, { group: false });
    await page.goto('/');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(
      page.getByText('Gib eine gültige E-Mail-Adresse ein.', { exact: true }),
    ).toBeVisible();
    await signInGerman(page);
    await page.getByLabel('Name der Organisation', { exact: true }).fill('Office team');
    await page.getByLabel('Adresse oder Umgebung der Organisation', { exact: true }).fill('Berlin');
    await page.getByRole('button', { name: 'Standort suchen', exact: true }).click();
    await page
      .getByRole('button', { name: 'Berlin Mitte, Germany auswählen', exact: true })
      .click();
    const creating = page.waitForRequest('**/rpc/create_organization');
    await page.getByRole('button', { name: 'Organisation erstellen', exact: true }).click();
    expect((await creating).postDataJSON()).toMatchObject({
      org_name: 'Office team',
      office_label: 'Berlin Mitte, Germany',
    });
    await page.getByRole('tab', { name: /Restaurants/ }).click();
    await expect(
      page.locator('[aria-label="Standort der Organisation: Office team"]'),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: /Restaurants/ })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test('German cuisine search, ratings and filters keep canonical tags and star ratings', async ({
    page,
  }) => {
    const errors = await backend(page, { reviewed: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await signInGerman(page);
    await expect(page.getByText('1 bewerteter Ort auf der Karte', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Miso Kitchen, 5,0 Sterne', exact: true }).click();
    await page.getByRole('button', { name: 'Küche für dein Team bearbeiten', exact: true }).click();
    await page.getByLabel('OSM-Küchen suchen', { exact: true }).fill('Italienisch');
    await page.getByRole('checkbox', { name: 'Italienisch', exact: true }).click();
    const cuisine = page.waitForRequest('**/rpc/set_place_cuisines');
    await page.getByRole('button', { name: 'Küche speichern', exact: true }).click();
    expect((await cuisine).postDataJSON().cuisines).toEqual(['japanese', 'italian']);
    await page.getByRole('button', { name: '4 ★', exact: true }).click();
    await page.getByLabel('Deine Meinung (optional)').fill('Breakfast');
    const review = page.waitForRequest('**/rpc/save_review');
    await page.getByRole('button', { name: 'Änderungen speichern', exact: true }).click();
    expect((await review).postDataJSON()).toMatchObject({
      rating: 4,
      review_comment: 'Breakfast',
    });
    await expect(page.getByText('Breakfast', { exact: true })).toBeVisible();
    await expect(page.getByText(/★ 4,0/).first()).toBeVisible();
    await expect(page.getByText(/12\.10\.2026/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByRole('button', { name: 'Küche: Alle Küchen', exact: true }).click();
    await page.getByRole('radio', { name: 'Italienisch', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Küche: Italienisch', exact: true }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Listenansicht', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Listenansicht', exact: true })).toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Küche: Italienisch', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Bewertungen lesen', exact: true }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Kartenansicht', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Miso Kitchen, 4,0 Sterne', exact: true }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
  test('German lunch prices accept decimal commas, display euros and preserve PayPal amounts', async ({
    page,
  }) => {
    const errors = await backend(page);
    await signInGerman(page);
    await page.getByRole('tab', { name: /Kochen/ }).click();
    await page.getByRole('button', { name: 'Mittagessen organisieren', exact: true }).click();
    await page.getByLabel('Preis pro Portion (EUR)').fill('4,29');
    await page
      .getByLabel('PayPal.me-Nutzername oder Link (bei kostenpflichtigem Essen erforderlich)')
      .fill('LunchCook');
    const creating = page.waitForRequest('**/rpc/create_cooking_event');
    await page.getByRole('button', { name: 'Mittagessen erstellen', exact: true }).click();
    expect((await creating).postDataJSON().portion_price).toBe(429);
    await page.getByLabel('Deine Portionen').fill('2');
    await page.getByRole('button', { name: 'Meine Portionen speichern', exact: true }).click();
    await expect(page.getByRole('button', { name: /8,58.*mit PayPal bezahlen/ })).toBeVisible();
    const paypal = page
      .context()
      .waitForEvent('request', (request) => request.url().startsWith('https://paypal.me/'));
    await page.context().route('https://paypal.me/**', (route) => route.abort());
    await page.getByRole('button', { name: /8,58.*mit PayPal bezahlen/ }).click();
    expect((await paypal).url()).toBe('https://paypal.me/LunchCook/8.58EUR');
    expect(errors).toEqual([]);
  });
});

test('an unavailable map directs users to the ranked Places list', async ({ page }) => {
  const errors = await backend(page, { reviewed: true });
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({ status: 503, body: 'Unavailable' }),
  );
  await signIn(page);
  await expect(
    page.getByText('Map tiles are unavailable. Switch to the list view to read reviews.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await expect(
    page
      .getByText('Miso Kitchen', { exact: true })
      .and(page.locator(':not([aria-hidden="true"] *)')),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Read reviews', exact: true }).click();
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('organization header appears once and switches scoped data on each tab, persisting selection', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, multipleOrganizations: true });
  await signIn(page);
  const selector = (name: string) =>
    page.getByRole('button', { name: `Switch organization. Current: ${name}`, exact: true });
  let current = 'Office team';
  for (const { tab, view } of [
    { tab: 'Places', view: 'Map view' },
    { tab: 'Places', view: 'List view' },
    { tab: 'Cooking', view: null },
  ]) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    await expect(selector(current)).toHaveCount(1);
    await expect(page.getByText(current.toUpperCase(), { exact: true })).toHaveCount(0);
    await selector(current).click();
    const menu = page.getByRole('dialog', { name: 'Switch organization', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('radio', { name: current, exact: true })).toBeChecked();
    const next = current === 'Office team' ? 'Other team' : 'Office team';
    const nextId = next === 'Office team' ? orgId : otherOrgId;
    const request = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname ===
          (tab === 'Cooking' ? '/rest/v1/cooking_events' : '/rest/v1/place_ratings') &&
        url.searchParams.get('organization_id') === `eq.${nextId}`
      );
    });
    await menu.getByRole('radio', { name: next, exact: true }).press('Space');
    await request;
    await expect(menu).toHaveCount(0);
    await expect(selector(next)).toBeVisible();
    await expect(page.getByRole('tab', { name: new RegExp(tab) })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    if (view) await page.getByRole('radio', { name: view, exact: true }).click();
    if (next === 'Other team' && view === 'Map view') {
      await expect(page.getByText('0 reviewed spots on the map', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }),
      ).toHaveCount(0);
    }
    if (next === 'Office team' && view === 'List view')
      await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toBeVisible();
    current = next;
  }
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await expect(selector('Other team')).toBeVisible();
  await expect(page.getByText('0 reviewed spots on the map', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('organization dropdown dismisses without changing filters and supports managing a single membership', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, stars: 4 });
  await signIn(page);
  await page.getByRole('button', { name: 'Rating: Any rating', exact: true }).click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).click();
  const selector = page.getByRole('button', {
    name: 'Switch organization. Current: Office team',
    exact: true,
  });
  await selector.click();
  await page.keyboard.press('Escape');
  await expect(selector).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Rating: 4.5+ stars', exact: true })).toBeVisible();
  await selector.click();
  await page.getByRole('radio', { name: 'Office team', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rating: 4.5+ stars', exact: true })).toBeVisible();
  await selector.click();
  await page.getByRole('button', { name: 'Manage organizations', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Your team/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Start a lunch circle', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create organization', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German organization dropdown', () => {
  test.use({ locale: 'de-DE' });
  test('header and dropdown support German, dark mode and a narrow viewport', async ({ page }) => {
    const errors = await backend(page, { multipleOrganizations: true });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    const selector = page.getByRole('button', {
      name: 'Organisation wechseln. Aktuell: Office team',
      exact: true,
    });
    await expect(selector).toBeVisible();
    await expect(page.getByText('OFFICE TEAM', { exact: true })).toHaveCount(0);
    await selector.click();
    const menu = page.getByRole('dialog', { name: 'Organisation wechseln', exact: true });
    await expect(menu).toHaveCSS('background-color', 'rgb(28, 32, 39)');
    const box = await menu.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(Math.abs(box!.x + box!.width / 2 - 160)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y + box!.height / 2 - 370)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect
      .poll(async () => {
        const resized = (await menu.boundingBox())!;
        return Math.max(
          Math.abs(resized.x + resized.width / 2 - 450),
          Math.abs(resized.y + resized.height / 2 - 350),
        );
      })
      .toBeLessThanOrEqual(1);
    await page
      .getByRole('button', { name: 'Organisationsauswahl schließen', exact: true })
      .last()
      .click();
    await expect(selector).toHaveAttribute('aria-expanded', 'false');
    await selector.click();
    await menu.getByRole('radio', { name: 'Other team', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Organisation wechseln. Aktuell: Other team', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('credits are centralized and restaurant search has one source notice for all results', async ({
  page,
}) => {
  const errors = await backend(page);
  await page.route('https://forkcast-test.supabase.co/functions/v1/places', async (route) => {
    if (route.request().postDataJSON().action !== 'search') return route.fallback();
    const base = {
      provider: 'osm',
      address: 'Berlin',
      latitude: 52.52,
      longitude: 13.4,
      types: ['restaurant', 'cuisine:japanese'],
      category: 'Japanese restaurant',
      hours: [],
      attributions: [],
    };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        places: [
          { ...base, id: 'osm:node:1', name: 'Miso Kitchen' },
          { ...base, id: 'osm:node:2', name: 'Second Kitchen' },
        ],
      }),
    });
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Find a place & add a review', exact: true }).click();
  await page.getByLabel('Restaurant or cuisine').fill('Kitchen');
  await page.getByRole('button', { name: 'Search lunch spots', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View place & review', exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByRole('link', { name: 'Data: OpenStreetMap', exact: true })).toHaveCount(1);
  await expect(
    page.getByRole('link', { name: '© OpenStreetMap contributors · ODbL', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Credits & licenses', exact: true }).click();
  const credits = page.getByRole('dialog', { name: 'Credits & licenses', exact: true });
  await expect(
    credits.getByRole('link', { name: '© OpenStreetMap contributors', exact: true }),
  ).toBeVisible();
  await expect(credits.getByRole('link', { name: 'OpenFreeMap', exact: true })).toBeVisible();
  await expect(credits.getByRole('link', { name: '© OpenMapTiles', exact: true })).toBeVisible();
  await expect(credits.getByText(/Copyright \(c\) iD Contributors/)).toBeVisible();
  await page.getByRole('button', { name: 'Close credits', exact: true }).click();
  await expect(page.getByLabel('Restaurant or cuisine')).toHaveValue('Kitchen');
  await page.getByRole('button', { name: 'View place & review', exact: true }).first().click();
  await expect(page.getByRole('link', { name: 'Data: OpenStreetMap', exact: true })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('web maps retain source attribution inside the map without an extra credit block', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        version: 8,
        sources: {
          empty: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            attribution:
              '<a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#FFF9F2' } },
          { id: 'empty', type: 'circle', source: 'empty' },
        ],
      }),
    }),
  );
  await signIn(page);
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  await expect(
    attribution.getByRole('link', { name: '© OpenStreetMap contributors', exact: true }),
  ).toBeVisible();
  await expect(
    attribution.getByRole('link', { name: '© OpenMapTiles', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Data: OpenStreetMap', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Data: OpenStreetMap', exact: true })).toHaveCount(1);
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Credits & licenses', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Credits & licenses', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Credits & licenses', exact: true })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test.describe('German credits', () => {
  test.use({ locale: 'de-DE' });
  test('central credits work before organization creation and support German dark mode', async ({
    page,
  }) => {
    const errors = await backend(page, { group: false });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByLabel('Name der Organisation', { exact: true }).fill('Dynabase');
    await page.getByRole('button', { name: 'Quellen & Lizenzen', exact: true }).click();
    const credits = page.getByRole('dialog', { name: 'Quellen & Lizenzen', exact: true });
    await expect(credits).toHaveCSS('background-color', 'rgb(28, 32, 39)');
    await expect(credits.getByText('Restaurant- und Adressdaten', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Quellenangaben schließen', exact: true })
      .last()
      .click();
    await expect(page.getByLabel('Name der Organisation', { exact: true })).toHaveValue('Dynabase');
    expect(errors).toEqual([]);
  });
});

test('saved restaurants do not fill the daily shortlist and a fallback pick adds only one', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await signIn(page, 'Overview');
  await expect(page.getByText('No restaurant options yet', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(dialog.getByText('Picking from 1 restaurant', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'View candidates · 1', exact: true }).click();
  await expect(dialog.getByText('Miso Kitchen', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  await expect(dialog.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('lunch-confetti')).toBeVisible();
  await page.screenshot({ path: '/tmp/forkcast-wheel-celebration.png' });
  await expect(dialog.getByTestId('lunch-confetti')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Close restaurant picker', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('wheel rotates continuously in the browser and finishes before a slow overview refresh', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, nominated: true });
  let slowRefresh = false;
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/rpc/lunch_overview',
    async (route) => {
      if (slowRefresh) await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fallback();
    },
  );
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/rpc/spin_lunch_wheel',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2600));
      await route.fallback();
    },
  );
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  const disc = dialog.getByTestId('lunch-wheel-disc');
  slowRefresh = true;
  const response = page.waitForResponse('**/rpc/spin_lunch_wheel');
  await dialog.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  await expect.poll(() => disc.evaluate((el) => el.getAnimations().length)).toBe(1);
  const start = await disc.evaluate((el) => {
    const animation = el.getAnimations()[0];
    return { time: animation.startTime, iterations: animation.effect?.getTiming().iterations };
  });
  expect(start.iterations).toBe(Infinity);
  await page.waitForTimeout(1600);
  const later = await disc.evaluate((el) => {
    const animation = el.getAnimations()[0];
    return { time: animation.startTime, progress: Number(animation.currentTime) };
  });
  expect(later.time).toBe(start.time);
  expect(later.progress).toBeGreaterThan(1400);
  await response;
  await expect(dialog.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible({
    timeout: 1500,
  });
  await dialog.getByRole('button', { name: 'Close restaurant picker', exact: true }).click();
  await expect(page.getByText('Picked by the wheel for your team.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('wheel honors reduced motion and failed picks do not trigger confetti', async ({ page }) => {
  const errors = await backend(page, { reviewed: true, nominated: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(dialog.getByTestId('lunch-confetti')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  await expect(dialog.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('lunch-confetti')).toHaveCount(0);
  await page.route('https://forkcast-test.supabase.co/rest/v1/rpc/spin_lunch_wheel', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Pick failed. Please try again.' }),
    }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(200);
  await expect(dialog.getByTestId('lunch-confetti')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  await expect(dialog.getByText('Pick failed. Please try again.', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('lunch-confetti')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('saved-place suggestions can be searched and added without another review', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Suggest a restaurant for today', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest a restaurant for today', exact: true });
  await dialog.getByLabel('Search saved places', { exact: true }).fill('missing');
  await expect(
    dialog.getByText('No saved places match your search.', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('Search saved places', { exact: true }).fill('Miso');
  const request = page.waitForRequest('**/rpc/suggest_lunch_place');
  await dialog.getByRole('button', { name: 'Suggest Miso Kitchen', exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ osm_place_id: 'osm:node:1' });
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('daily shortlist previews only three places and full-list voting works in its searchable modal', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, shortlistCount: 8 });
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await expect(page.getByRole('button', { name: /^Vote for / })).toHaveCount(3);
  await page.getByRole('button', { name: 'View all · 8', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Today’s restaurant shortlist', exact: true });
  await expect(dialog.getByRole('button', { name: /^Vote for / })).toHaveCount(8);
  await dialog.getByLabel('Search today’s options', { exact: true }).fill('107');
  await dialog.getByRole('button', { name: 'Vote for Lunch spot 107', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Remove my vote for Lunch spot 107', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close lunch dialog', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove my vote for Lunch spot 107', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Vote for|Remove my vote for) / })).toHaveCount(
    3,
  );
  expect(errors).toEqual([]);
});

test('wheel candidates can be searched without changing the eligible pool', async ({ page }) => {
  const errors = await backend(page, { reviewed: true, shortlistCount: 8 });
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(picker.getByText('Picking from 8 restaurants', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'View candidates · 8', exact: true }).click();
  await picker.getByLabel('Search candidates', { exact: true }).fill('missing');
  await expect(picker.getByText('No candidates match your search.', { exact: true })).toBeVisible();
  await picker.getByLabel('Search candidates', { exact: true }).fill('107');
  await expect(picker.getByText('Lunch spot 107', { exact: true })).toBeVisible();
  await expect(picker.getByText('Miso Kitchen', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/forkcast-wheel-candidates.png' });
  const request = page.waitForRequest('**/rpc/spin_lunch_wheel');
  await picker.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  expect((await request).postDataJSON().candidate_ids).toHaveLength(8);
  await expect(picker.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('an empty wheel explains missing reviews and can open suggestions', async ({ page }) => {
  const errors = await backend(page);
  await signIn(page, 'Overview');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(
    picker.getByText(
      'No reviewed restaurants yet. Review a place or suggest a restaurant for today.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Spin the wheel', exact: true })).toBeDisabled();
  await picker.getByRole('button', { name: 'Suggest a place', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(
    page.getByRole('dialog', { name: 'Suggest a restaurant for today', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('picker respects Places filters and shows an empty state without spinning', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, stars: 4 });
  await signIn(page);
  await page.getByRole('button', { name: 'Rating: Any rating', exact: true }).click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).click();
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(
    picker.getByText('No restaurants match these filters.', { exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Spin the wheel', exact: true })).toBeDisabled();
  await expect(
    picker.getByText('Cuisine: All cuisines\nRating: 4.5+ stars', { exact: true }),
  ).toBeVisible();
  await picker.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(picker.getByText('Picking from 1 restaurant', { exact: true })).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Spin the wheel', exact: true })).toBeEnabled();
  await picker.getByRole('button', { name: 'Adjust filters', exact: true }).click();
  await expect(page.getByLabel('Restaurant wheel', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Places/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Rating: Any rating', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('picker prioritizes nominations over Places filters', async ({ page }) => {
  const errors = await backend(page, { reviewed: true, stars: 4, nominated: true });
  await signIn(page);
  await page.getByRole('button', { name: 'Rating: Any rating', exact: true }).click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).click();
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(
    picker.getByText('Choosing from today’s nominations.', { exact: true }),
  ).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Adjust filters', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'View candidates · 1', exact: true }).click();
  await expect(picker.getByText('Miso Kitchen', { exact: true })).toBeVisible();
  const box = await picker.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(box!.y + box!.height / 2 - 422)).toBeLessThan(2);
  await page.screenshot({ path: '/tmp/forkcast-restaurant-picker.png' });
  await page.screenshot({ path: '/tmp/forkcast-wheel-stylized.png' });

  const spin = page.waitForRequest('**/rpc/spin_lunch_wheel');
  await picker.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  expect((await spin).postDataJSON()).toMatchObject({ candidate_ids: ['osm:node:1'] });
  await expect(picker.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Overview is default, saves daily choices and votes, and shares a wheel result across reload', async ({
  page,
}) => {
  const errors = await backend(page, {
    reviewed: true,
    nominated: true,
    multipleOrganizations: true,
  });
  await signIn(page, 'Overview');
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText("What's for lunch today?", { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeDisabled();
  const answer = page.waitForRequest('**/rpc/set_lunch_response');
  await page.getByRole('radio', { name: "I'm going out", exact: true }).press('Space');
  expect((await answer).postDataJSON()).toMatchObject({ org: orgId, answer: 'going_out' });
  await expect(page.getByRole('radio', { name: "I'm going out", exact: true })).toBeChecked();
  const vote = page.waitForRequest('**/rpc/vote_lunch_place');
  await page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }).click();
  expect((await vote).postDataJSON()).toMatchObject({ org: orgId, osm_place_id: 'osm:node:1' });
  await expect(page.getByText('1 vote', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Restaurant wheel', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(picker.getByLabel('Restaurant wheel', { exact: true })).toBeVisible();
  const spin = page.waitForRequest('**/rpc/spin_lunch_wheel');
  await picker.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  expect((await spin).postDataJSON()).toMatchObject({ candidate_ids: ['osm:node:1'] });
  await expect(page.getByText('Wheel result: Miso Kitchen', { exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Spin the wheel', exact: true })
    .getByRole('button', { name: 'Close restaurant picker', exact: true })
    .click();
  await expect(page.getByLabel('Restaurant wheel', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('Picked by the wheel for your team.', { exact: true })).toBeVisible();
  await expect(page.getByText('Miso Kitchen', { exact: true })).toHaveCount(1);
  await page.getByRole('radio', { name: "I'm eating in the office", exact: true }).click();
  await expect(
    page.getByRole('radio', { name: "I'm eating in the office", exact: true }),
  ).toBeChecked();
  await expect(page.getByText('0 votes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spin the wheel', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'No lunch / not in the office', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: 'No lunch / not in the office', exact: true }),
  ).toBeChecked();
  const ordering = page.waitForRequest('**/rpc/set_lunch_response');
  await page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }).click();
  expect((await ordering).postDataJSON()).toMatchObject({ answer: 'ordering_in' });
  await expect(
    page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Spin the wheel', exact: true })).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }),
  ).toBeChecked();

  await page
    .getByRole('button', { name: 'Switch organization. Current: Office team', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Other team', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Overview/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('No restaurant options yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Wheel result: Miso Kitchen', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Overview can suggest a restaurant and shows only today’s cooking with portion signup', async ({
  page,
}) => {
  const errors = await backend(page);
  const meals = [
    {
      id: 'today-meal',
      organization_id: orgId,
      organizer_id: userId,
      meal_date: localDate(),
      title: 'Today curry',
      description: null,
      max_portions: null,
      price_cents: 429,
      currency: 'EUR',
      paypal_handle: 'Alice',
      profiles: { id: userId, display_name: 'Alice' },
    },
    {
      id: 'future-meal',
      organization_id: orgId,
      organizer_id: userId,
      meal_date: '2099-01-01',
      title: 'Future meal',
    },
  ];
  await page.route('https://forkcast-test.supabase.co/rest/v1/cooking_events**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        url.searchParams.has('id')
          ? meals[0]
          : meals.filter((meal) => url.searchParams.get('meal_date') === `eq.${meal.meal_date}`),
      ),
    });
  });
  await signIn(page, 'Overview');
  await expect(page.getByText('Today curry', { exact: true })).toBeVisible();
  await expect(page.getByText('Future meal', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Suggest a restaurant for today', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Suggest a restaurant for today', exact: true })
    .getByRole('button', { name: 'Discover new places', exact: true })
    .click();
  await page.getByLabel('Restaurant or cuisine').fill('Miso');
  await page.getByRole('button', { name: 'Search lunch spots', exact: true }).click();
  const suggested = page.waitForRequest('**/rpc/suggest_lunch_place');
  await page.getByRole('button', { name: 'Suggest Miso Kitchen for today', exact: true }).click();
  expect((await suggested).postDataJSON()).toEqual({ org: orgId, osm_place_id: 'osm:node:1' });
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await expect(page.getByLabel('Your portions')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German lunch overview', () => {
  test.use({ locale: 'de-DE' });
  test('the German default overview supports the four choices, voting and the wheel in dark mode', async ({
    page,
  }) => {
    const errors = await backend(page, { reviewed: true, nominated: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await expect(page.getByText('Was gibts zum Mittagessen?', { exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Übersicht/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page
      .getByRole('radio', { name: 'Kein Mittagessen / nicht im Büro', exact: true })
      .click();
    await expect(
      page.getByRole('radio', { name: 'Kein Mittagessen / nicht im Büro', exact: true }),
    ).toBeChecked();
    await page.getByRole('radio', { name: 'Ich gehe auswärts essen', exact: true }).click();
    await page.getByRole('button', { name: 'Für Miso Kitchen stimmen', exact: true }).click();
    await expect(page.getByText('1 Stimme', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Ich bestelle Essen ins Büro', exact: true }).click();
    await expect(
      page.getByRole('radio', { name: 'Ich bestelle Essen ins Büro', exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole('radio').getByText('Ins Büro bestellen', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('0 Stimmen', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Glücksrad drehen', exact: true }),
    ).toBeDisabled();
    await page.reload();
    await expect(
      page.getByRole('radio', { name: 'Ich bestelle Essen ins Büro', exact: true }),
    ).toBeChecked();
    await page.getByRole('radio', { name: 'Ich gehe auswärts essen', exact: true }).click();
    await page.getByRole('button', { name: 'Glücksrad drehen', exact: true }).click();
    const wheelDialog = page.getByRole('dialog', { name: 'Glücksrad drehen', exact: true });
    await expect(wheelDialog.getByText('Auswahl aus 1 Restaurant', { exact: true })).toBeVisible();
    await wheelDialog.getByRole('button', { name: 'Restaurants ansehen · 1', exact: true }).click();
    await expect(wheelDialog.getByText('Miso Kitchen', { exact: true })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Glücksrad drehen', exact: true })
      .getByRole('button', { name: 'Glücksrad drehen', exact: true })
      .click();
    await expect(page.getByText('Glücksrad-Ergebnis: Miso Kitchen', { exact: true })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Glücksrad drehen', exact: true })
      .getByRole('button', { name: 'Restaurantauswahl schließen', exact: true })
      .click();
    await page.getByText('Was gibts zum Mittagessen?', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/forkcast-modern-german-dark.png', fullPage: false });
    await page
      .getByText('Der Plan für heute', { exact: true })
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: '/tmp/forkcast-clean-plan-german.png' });

    await page.getByRole('button', { name: 'Meine Antwort zurücknehmen', exact: true }).click();
    await expect(
      page.getByRole('radio', { name: 'Ich gehe auswärts essen', exact: true }),
    ).not.toBeChecked();
    expect(errors).toEqual([]);
  });
});

test('Overview refreshes shared attendance totals and restaurant votes from colleagues', async ({
  page,
}) => {
  const errors = await backend(page);
  let colleagueResponded = false;
  await page.route('https://forkcast-test.supabase.co/rest/v1/rpc/lunch_overview', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        day: localDate(),
        mine: 'going_out',
        myVote: null,
        pickedPlaceId: null,
        counts: {
          going_out: colleagueResponded ? 2 : 1,
          brought_food: 0,
          no_lunch: 0,
          ordering_in: 0,
          unanswered: colleagueResponded ? 0 : 1,
        },
        options: [
          {
            place: {
              id: 'osm:node:1',
              provider: 'osm',
              name: 'Miso Kitchen',
              address: 'Berlin',
              category: 'Japanese restaurant',
              latitude: 52.52,
              longitude: 13.4,
              types: ['restaurant', 'cuisine:japanese'],
              hours: [],
              attributions: [],
            },
            votes: colleagueResponded ? 1 : 0,
            override: null,
          },
        ],
      }),
    }),
  );
  await page.clock.install();
  await signIn(page, 'Overview');
  await expect(page.getByText('0 votes', { exact: true })).toBeVisible();
  colleagueResponded = true;
  await page.clock.fastForward(65000);
  await expect(page.getByText('1 vote', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Going out', { exact: true }).locator('..').getByText('2', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('notification bell supports unread markers, quick join, payments and scoped dismissals', async ({
  page,
}) => {
  const errors = await backend(page, { notifications: true, multipleOrganizations: true });
  await signIn(page, 'Overview');
  const bell = page.getByRole('button', { name: 'Notifications: 3 unread', exact: true });
  await expect(bell.getByTestId('notification-unread-marker')).toBeVisible();
  await bell.click();
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('New office cooking', { exact: false })).toBeVisible();
  const paymentReminder = inbox.getByText('Pending lunch', { exact: true }).locator('..');
  await expect(
    paymentReminder.getByRole('button', { name: 'Dismiss notification', exact: true }),
  ).toHaveCount(0);
  await expect(
    paymentReminder.getByRole('button', { name: 'View lunch & payment', exact: true }),
  ).toBeVisible();
  await expect(
    inbox.getByRole('button', { name: 'Dismiss notification', exact: true }),
  ).toHaveCount(2);

  await expect(
    inbox.getByText('Bob marked €8.50 as paid (self-reported).', { exact: true }),
  ).toBeVisible();
  const joining = page.waitForRequest('**/rpc/join_notification_lunch');
  await inbox.getByRole('button', { name: 'Join · 1 portion', exact: true }).click();
  expect((await joining).postDataJSON()).toEqual({ org: orgId, notice: 'new-cooking' });
  await expect(page.getByLabel('Your portions')).toHaveValue('1');
  await page.getByRole('button', { name: 'Notifications: 2 unread', exact: true }).click();
  await inbox.getByRole('button', { name: 'View lunch & payment', exact: true }).click();
  await expect(page.getByRole('button', { name: /Pay .*4.25.* with PayPal/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Notifications: 2 unread', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I have paid', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }).click();
  await expect(inbox.getByText('Payment reminder', { exact: false })).toHaveCount(0);
  await inbox.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
  await expect(inbox.getByText('You’re all caught up', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'Close notifications', exact: true }).click();
  await expect(
    page
      .getByRole('button', { name: 'Notifications: 0 unread', exact: true })
      .getByTestId('notification-unread-marker'),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page
    .getByRole('button', { name: 'Switch organization. Current: Office team', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Other team', exact: true }).click();
  await page.getByRole('button', { name: 'Notifications: 0 unread', exact: true }).click();
  await expect(inbox.getByText('You’re all caught up', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German notifications', () => {
  test.use({ locale: 'de-DE' });
  test('the inbox follows system language, dark mode and read status', async ({ page }) => {
    const errors = await backend(page, { notifications: true });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page
      .getByRole('button', { name: 'Benachrichtigungen: 3 ungelesen', exact: true })
      .click();
    const inbox = page.getByRole('dialog', { name: 'Benachrichtigungen', exact: true });
    await expect(inbox).toHaveCSS('background-color', 'rgb(28, 32, 39)');
    await expect(
      inbox
        .getByText('Pending lunch', { exact: true })
        .locator('..')
        .getByRole('button', { name: 'Benachrichtigung verwerfen', exact: true }),
    ).toHaveCount(0);

    await expect(
      inbox.getByText('Bob hat 8,50 € als bezahlt markiert (selbst angegeben).', { exact: true }),
    ).toBeVisible();
    await inbox.getByRole('button', { name: 'Alle als gelesen markieren', exact: true }).click();
    await expect(inbox.getByText('Ungelesen', { exact: false })).toHaveCount(1);
    await expect(
      inbox.getByRole('button', { name: 'Alle als gelesen markieren', exact: true }),
    ).toHaveCount(0);
    await inbox.getByRole('button', { name: 'Benachrichtigungen schließen', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Benachrichtigungen: 1 ungelesen', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('the header unread marker refreshes automatically when a colleague schedules cooking', async ({
  page,
}) => {
  const errors = await backend(page);
  let scheduled = false;
  await page.route('https://forkcast-test.supabase.co/rest/v1/rpc/notification_inbox', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        unread: scheduled ? 1 : 0,
        items: scheduled
          ? [
              {
                id: 'new',
                event_id: 'meal',
                kind: 'cooking_scheduled',
                title: 'New colleague lunch',
                meal_date: localDate(),
                actor_name: 'Bob',
                price_cents: 0,
                portions: null,
                read_at: null,
              },
            ]
          : [],
      }),
    }),
  );
  await page.clock.install();
  await signIn(page, 'Overview');
  await expect(
    page.getByRole('button', { name: 'Notifications: 0 unread', exact: true }),
  ).toBeVisible();
  scheduled = true;
  await page.clock.fastForward(65000);
  const bell = page.getByRole('button', { name: 'Notifications: 1 unread', exact: true });
  await expect(bell.getByTestId('notification-unread-marker')).toBeVisible();
  await bell.click();
  await expect(
    page
      .getByRole('dialog', { name: 'Notifications', exact: true })
      .getByText('New colleague lunch', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('compact lunch dashboard groups attendance and keeps the plan close to the top', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await signIn(page, 'Overview');
  const choices = page.getByRole('radiogroup', { name: 'Your lunch today', exact: true });
  const going = choices.getByRole('radio', { name: "I'm going out", exact: true });
  const brought = choices.getByRole('radio', { name: "I'm eating in the office", exact: true });
  const boxes = await Promise.all([going.boundingBox(), brought.boundingBox()]);
  expect(Math.round(boxes[0]!.y)).toBe(Math.round(boxes[1]!.y));
  expect(boxes[0]!.height).toBeGreaterThanOrEqual(44);
  expect((await choices.boundingBox())!.height).toBeLessThan(170);
  await expect(page.getByText('Choose your lunch · team totals', { exact: true })).toHaveCount(0);
  expect((await page.getByText("Today's plan", { exact: true }).boundingBox())!.y).toBeLessThan(
    650,
  );
  await expect(
    page.getByText('One answer per person. You can change it anytime today.', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'How lunch planning works', exact: true }).click();
  await expect(
    page.getByText('One answer per person. You can change it anytime today.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'How lunch planning works', exact: true }).click();
  await going.click();
  await expect(going).toBeChecked();
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(going).toBeChecked();
  await page.getByText("What's for lunch today?", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/forkcast-compact-overview.png', fullPage: false });
  await expect(
    page.getByRole('button', { name: 'Host an office lunch', exact: true }),
  ).toContainText('Plan lunch');
  await expect(
    page.getByRole('button', { name: 'Suggest a restaurant for today', exact: true }),
  ).toContainText('Suggest a place');
  await page
    .getByText("Today's plan", { exact: true })
    .evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/forkcast-clean-plan.png' });

  expect(errors).toEqual([]);
});

test('OSM editor return automatically refreshes source cuisines while preserving reviews and local overrides', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, sourceUpdates: true });
  await signIn(page);
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }).click();
  const refreshed = page.waitForRequest(
    (request) =>
      request.url().endsWith('/functions/v1/places') && request.postDataJSON().refresh === true,
  );
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  const editing = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Edit on OpenStreetMap', exact: true }).click();
  const editor = await editing;
  await editor.close();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  expect((await refreshed).postDataJSON()).toMatchObject({
    organizationId: orgId,
    action: 'details',
    ids: ['osm:node:1'],
    refresh: true,
  });
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('RESTAURANT · THAI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit cuisine for your team', exact: true }).click();
  await page.getByLabel('Search OSM cuisines', { exact: true }).fill('Italian');
  await page.getByRole('checkbox', { name: 'Italian', exact: true }).click();
  await page.getByRole('button', { name: 'Save cuisine', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('Cuisine supplied by your team', { exact: false })).toBeVisible();
  const reverted = page.waitForRequest(
    (request) =>
      request.url().endsWith('/functions/v1/places') && request.postDataJSON().refresh === true,
  );
  await page.getByRole('button', { name: 'Use OpenStreetMap cuisine', exact: true }).click();
  await reverted;
  await expect(page.getByText('RESTAURANT · THAI', { exact: true })).toBeVisible();
  await expect(page.getByText('Original visit', { exact: true }).last()).toBeVisible();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.getByRole('button', { name: 'Cuisine: All cuisines', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Thai', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('live changes refresh only relevant data, coalesce bursts and preserve review drafts', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { reviewed: true, live });
  let reviewReads = 0;
  let nextComment = false;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/rest/v1/current_reviews' &&
      !new URL(request.url()).searchParams.has('author_id')
    )
      reviewReads++;
  });
  await page.route('https://forkcast-test.supabase.co/rest/v1/current_reviews**', (route) =>
    new URL(route.request().url()).searchParams.has('author_id')
      ? route.fallback()
      : route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(
            nextComment
              ? [
                  {
                    id: 'new-review',
                    organization_id: orgId,
                    place_id: 'osm:node:1',
                    author_id: userId,
                    stars: 5,

                    comment: 'A colleague just reviewed this',
                    created_at: new Date().toISOString(),
                    profiles: { id: userId, display_name: 'Bob' },
                  },
                ]
              : [],
          ),
        }),
  );
  await signIn(page);
  await page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }).click();
  await page
    .getByLabel('Your thoughts (optional)', { exact: true })
    .fill('Keep my unfinished review');
  await expect.poll(() => reviewReads).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const before = reviewReads;
  live.emit!('cooking');
  live.emit!('places', otherOrgId);
  await page.waitForTimeout(500);
  expect(reviewReads).toBe(before);
  nextComment = true;
  for (let i = 0; i < 10; i++) live.emit!('places');
  await expect(page.getByText('A colleague just reviewed this', { exact: true })).toBeVisible();
  expect(reviewReads).toBe(before + 1);
  await expect(page.getByLabel('Your thoughts (optional)', { exact: true })).toHaveValue(
    'Keep my unfinished review',
  );
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('live notifications update the header without waiting for a polling interval', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { live });
  let arrived = false;
  await page.route('https://forkcast-test.supabase.co/rest/v1/rpc/notification_inbox', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        unread: arrived ? 1 : 0,
        items: arrived
          ? [
              {
                id: 'live',
                event_id: 'meal',
                kind: 'cooking_scheduled',
                title: 'Live cooking invitation',
                meal_date: localDate(),
                actor_name: 'Bob',
                price_cents: 0,
                portions: null,
                read_at: null,
              },
            ]
          : [],
      }),
    }),
  );
  await signIn(page, 'Overview');
  await page.waitForTimeout(500);
  arrived = true;
  live.emit!('inbox');
  await expect(
    page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Notifications', exact: true })
      .getByText('Live cooking invitation', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('reconnecting reloads cooking changes missed while the live connection was down', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { live });
  let scheduled = false;
  await page.route('https://forkcast-test.supabase.co/rest/v1/cooking_events**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        scheduled
          ? [
              {
                id: 'missed-meal',
                organization_id: orgId,
                organizer_id: userId,
                meal_date: localDate(),
                title: 'Scheduled during disconnection',
                description: null,
                max_portions: null,
                price_cents: 0,
                profiles: { id: userId, display_name: 'Bob' },
              },
            ]
          : [],
      ),
    }),
  );
  await signIn(page);
  await page.getByRole('tab', { name: /Cooking/ }).click();
  await expect(page.getByText('The kitchen is open', { exact: true })).toBeVisible();
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  const joins = live.joins!;
  scheduled = true;
  live.close!();
  await expect.poll(() => live.joins ?? 0, { timeout: 10000 }).toBeGreaterThan(joins);
  await expect(page.getByText('Scheduled during disconnection', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Refresh/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('live cooking updates preserve unsaved portion edits', async ({ page }) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { live, notifications: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Notifications: 3 unread', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Notifications', exact: true })
    .getByRole('button', { name: 'Join · 1 portion', exact: true })
    .click();
  await expect(page.getByLabel('Your portions', { exact: true })).toHaveValue('1');
  await page.getByLabel('Your portions', { exact: true }).fill('3');
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/cooking_event_participants**',
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          {
            event_id: '20000000-0000-0000-0000-000000000001',
            user_id: userId,
            portions: 2,
            paid: false,
            profiles: { id: userId, display_name: 'Alice' },
          },
        ]),
      }),
  );
  live.emit!('cooking');
  await expect(page.getByRole('button', { name: /Pay .*8.50.* with PayPal/ })).toBeVisible();
  await expect(page.getByLabel('Your portions', { exact: true })).toHaveValue('3');
  expect(errors).toEqual([]);
});

test('organizers create a Berlin signup deadline, close signup, allow reductions and reopen it', async ({
  page,
}) => {
  const errors = await backend(page);
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Cooking/ }).click();
  await page.getByRole('button', { name: 'Host an office lunch', exact: true }).click();
  await page.getByLabel('Date (YYYY-MM-DD)', { exact: true }).fill('2099-10-13');
  await page.getByLabel('Meal name (optional)', { exact: true }).fill('Deadline curry');
  await page.getByRole('button', { name: 'Set a deadline', exact: true }).click();
  await page.getByLabel('Signup date (YYYY-MM-DD)', { exact: true }).fill('2099-10-13');
  await page.getByLabel('Signup time (HH:mm)', { exact: true }).fill('11:00');
  const creating = page.waitForRequest('**/rpc/create_cooking_event');
  await page.getByRole('button', { name: 'Create lunch', exact: true }).click();
  expect((await creating).postDataJSON().signup_until).toBe('2099-10-13T09:00:00.000Z');
  await expect(page.getByText(/Signup closes .*11:00.*Berlin time/)).toBeVisible();
  await page.getByLabel('Your portions', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save my portions', exact: true }).click();
  await page.getByRole('button', { name: 'Edit signup deadline', exact: true }).click();
  await expect(page.getByLabel('Signup time (HH:mm)', { exact: true })).toHaveValue('11:00');
  const closing = page.waitForRequest('**/rpc/set_cooking_signup_deadline');
  await page.getByRole('button', { name: 'Close signup now', exact: true }).click();
  expect((await closing).postDataJSON()).toMatchObject({ deadline: null, close_now: true });
  await expect(
    page.getByText(
      'Signup is closed. You can reduce portions or leave; payment remains available.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Your portions', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Update portions', exact: true })).toBeDisabled();
  await page.getByLabel('Your portions', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Update portions', exact: true }).click();
  await expect(page.getByLabel('Your portions', { exact: true })).toHaveValue('1');
  const reopening = page.waitForRequest('**/rpc/set_cooking_signup_deadline');
  await page.getByRole('button', { name: 'Reopen signup', exact: true }).click();
  expect((await reopening).postDataJSON()).toMatchObject({ deadline: null, close_now: false });
  await page.getByLabel('Your portions', { exact: true }).fill('3');
  await expect(page.getByRole('button', { name: 'Update portions', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Set signup deadline', exact: true }).click();
  await page.getByRole('button', { name: 'Set a deadline', exact: true }).click();
  await page.getByLabel('Signup date (YYYY-MM-DD)', { exact: true }).fill('2099-10-12');
  await page.getByLabel('Signup time (HH:mm)', { exact: true }).fill('18:30');
  const editing = page.waitForRequest('**/rpc/set_cooking_signup_deadline');
  await page.getByRole('button', { name: 'Save signup deadline', exact: true }).click();
  expect((await editing).postDataJSON().deadline).toBe('2099-10-12T16:30:00.000Z');
  await page.screenshot({ path: '/tmp/forkcast-signup-deadline.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('signup deadline expires automatically in notifications and members cannot reserve or edit it', async ({
  page,
}) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  const errors = await backend(page, {
    notifications: true,
    nonOrganizer: true,
    signupDeadline: new Date(now + 120000).toISOString(),
  });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Notifications: 3 unread', exact: true }).click();
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(inbox.getByRole('button', { name: 'Join · 1 portion', exact: true })).toBeVisible();
  await page.clock.fastForward(120050);
  await expect(inbox.getByRole('button', { name: 'Join · 1 portion', exact: true })).toHaveCount(0);
  await expect(inbox.getByText('Signup closed', { exact: true })).toBeVisible();
  await inbox.getByRole('button', { name: 'View lunch', exact: true }).first().click();
  await expect(
    page.getByText('The signup deadline has passed. No new reservations can be made.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel('Your portions', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit signup deadline', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Reopen signup', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('German signup deadlines', () => {
  test.use({ locale: 'de-DE' });
  test('organizer deadline controls follow system language', async ({ page }) => {
    const errors = await backend(page, { notifications: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page
      .getByRole('button', { name: 'Mittagessen & Portionen ansehen', exact: true })
      .click();
    await page.getByRole('button', { name: 'Anmeldeschluss festlegen', exact: true }).click();
    await page.getByRole('button', { name: 'Anmeldung jetzt schließen', exact: true }).click();
    await expect(
      page.getByText(
        'Der Anmeldeschluss ist vorbei. Neue Reservierungen sind nicht mehr möglich.',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Anmeldung wieder öffnen', exact: true }).click();
    await expect(page.getByLabel('Deine Portionen', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('organizers receive signup alerts and can confirm an unpaid colleague from the roster', async ({
  page,
}) => {
  const errors = await backend(page, { roster: true, organizerSignups: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }).click();
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('New signup · Unread', { exact: true })).toBeVisible();
  await expect(
    inbox.getByText('Bob joined your lunch · 2 portions.', { exact: true }),
  ).toBeVisible();
  await expect(inbox.getByRole('button', { name: 'Join · 1 portion', exact: true })).toHaveCount(0);
  await inbox.getByRole('button', { name: 'View lunch', exact: true }).click();
  await expect(page.getByText('Participants · 3', { exact: true })).toBeVisible();
  const confirming = page.waitForRequest('**/rpc/confirm_cooking_payment');
  await page.getByRole('button', { name: 'Confirm payment for Bob', exact: true }).click();
  expect((await confirming).postDataJSON()).toEqual({
    event: '20000000-0000-0000-0000-000000000001',
    participant: '00000000-0000-0000-0000-000000000002',
    expected_portions: 2,
  });
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm payment for Bob', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Paid · 3 · €25.50', { exact: true })).toBeVisible();
  await page
    .getByText('Participants · 3', { exact: true })
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/forkcast-confirmed-roster.png' });
  expect(errors).toEqual([]);
});

test('participant payment confirmation is a normal notification and needs no further payment action', async ({
  page,
}) => {
  const errors = await backend(page, { roster: true, nonOrganizer: true, confirmedPayment: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }).click();
  const inbox = page.getByRole('dialog', { name: 'Notifications', exact: true });
  await expect(inbox.getByText('Bob confirmed your €4.25 payment.', { exact: true })).toBeVisible();
  await expect(
    inbox.getByRole('button', { name: 'Dismiss notification', exact: true }),
  ).toBeVisible();
  await inbox.getByRole('button', { name: 'View lunch & payment', exact: true }).click();
  await expect(
    page.getByText('Payment has been confirmed by the organizer.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Confirmed · €4.25', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marked paid — undo', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: /^Pay .* with PayPal$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Confirm payment for / })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Notifications: 0 unread', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German payment and signup alerts', () => {
  test.use({ locale: 'de-DE' });
  test('payment confirmation and organizer signup alerts follow system language', async ({
    page,
  }) => {
    const errors = await backend(page, { roster: true, organizerSignups: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page
      .getByRole('button', { name: 'Benachrichtigungen: 1 ungelesen', exact: true })
      .click();
    const inbox = page.getByRole('dialog', { name: 'Benachrichtigungen', exact: true });
    await expect(
      inbox.getByText('Bob hat sich für dein Mittagessen angemeldet · 2 Portionen.', {
        exact: true,
      }),
    ).toBeVisible();
    await inbox.getByRole('button', { name: 'Essen ansehen', exact: true }).click();
    await page.getByRole('button', { name: 'Zahlung von Bob bestätigen', exact: true }).click();
    await expect(page.getByText('Bestätigt', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('unreviewed restaurants can be bookmarked, persist across reload, nominated and removed', async ({
  page,
}) => {
  const errors = await backend(page);
  const reviews: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/save_review')) reviews.push(request.url());
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Find a place & add a review', exact: true }).click();
  await page.getByLabel('Restaurant or cuisine', { exact: true }).fill('Miso');
  await page.getByRole('button', { name: 'Search lunch spots', exact: true }).click();
  await page.getByRole('button', { name: 'View place & review', exact: true }).click();
  const saved = page.waitForRequest('**/rpc/set_restaurant_favorite');
  await page.getByRole('button', { name: 'Save Miso Kitchen to favorites', exact: true }).click();
  expect((await saved).postDataJSON()).toEqual({
    org: orgId,
    osm_place_id: 'osm:node:1',
    bookmarked: true,
  });
  await expect(
    page.getByRole('button', { name: 'Remove Miso Kitchen from favorites', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /Places/ }).click();
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Miso Kitchen', exact: true })).toBeVisible();
  const nomination = page.waitForRequest('**/rpc/suggest_lunch_place');
  await page.getByRole('button', { name: 'Nominate Miso Kitchen for today', exact: true }).click();
  expect((await nomination).postDataJSON()).toEqual({ org: orgId, osm_place_id: 'osm:node:1' });
  await expect(
    page.getByRole('button', { name: 'Miso Kitchen is already nominated for today', exact: true }),
  ).toBeDisabled();
  const removed = page.waitForRequest('**/rpc/set_restaurant_favorite');
  await page
    .getByRole('button', { name: 'Remove Miso Kitchen from favorites', exact: true })
    .click();
  expect((await removed).postDataJSON().bookmarked).toBe(false);
  await expect(page.getByText('No favorites yet', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Overview/ }).click();
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeVisible();
  expect(reviews).toEqual([]);
  expect(errors).toEqual([]);
});

test('overview favorites nominate quickly and are independent of reviewed-place filters', async ({
  page,
}) => {
  const errors = await backend(page, { favorited: true });
  await signIn(page);
  await page.getByRole('button', { name: 'Rating: Any rating', exact: true }).click();
  await page.getByRole('radio', { name: '4.5+ stars', exact: true }).click();
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Miso Kitchen', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('button', { name: 'Suggest a restaurant for today', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest a restaurant for today', exact: true });
  await expect(dialog.getByRole('button', { name: 'Favorites · 1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(dialog.getByLabel('Search saved places', { exact: true })).toHaveCount(0);
  await dialog
    .getByRole('button', { name: 'Nominate Miso Kitchen for today', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Vote for Miso Kitchen', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('favorites stay within the selected organization', async ({ page }) => {
  const errors = await backend(page, { favorited: true, multipleOrganizations: true });
  await signIn(page);
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Miso Kitchen', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Switch organization. Current: Office team', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Other team', exact: true }).click();
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByText('No favorites yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Miso Kitchen', exact: true })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Switch organization. Current: Other team', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Office team', exact: true }).click();
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View Miso Kitchen', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German favorites', () => {
  test.use({ locale: 'de-DE' });
  test('bookmarks and quick nominations follow system language', async ({ page }) => {
    const errors = await backend(page, { reviewed: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('tab', { name: /Restaurants/ }).click();
    await page.getByRole('button', { name: 'Miso Kitchen, 5,0 Sterne', exact: true }).click();
    await page
      .getByRole('button', { name: 'Miso Kitchen als Favorit speichern', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Miso Kitchen aus Favoriten entfernen', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    await page.getByRole('radio', { name: 'Favoritenansicht', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Miso Kitchen ansehen', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/forkcast-favorites-german.png' });
    await page
      .getByRole('button', { name: 'Miso Kitchen für heute vorschlagen', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Miso Kitchen ist bereits für heute vorgeschlagen',
        exact: true,
      }),
    ).toBeDisabled();
    expect(errors).toEqual([]);
  });
});

test('administrators who did not create the organization manage colleagues and can hand over their role', async ({
  page,
}) => {
  const errors = await backend(page, { differentCreator: true });
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await expect(
    page.getByRole('button', { name: 'Set organization location', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Invite colleagues', exact: true }).click();
  await page.getByRole('button', { name: 'Get invite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotate invite code', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Alice', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Make Alice a member', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Close member dialog', exact: true }).last().click();
  await page.getByRole('button', { name: 'Manage Bob', exact: true }).click();
  await page.getByRole('button', { name: 'Make Bob an administrator', exact: true }).click();
  await expect(page.getByText('2 members · 2 administrators', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Alice', exact: true }).click();
  await page.getByRole('button', { name: 'Make Alice a member', exact: true }).click();
  await expect(page.getByText('2 members · 1 administrator', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Make .* (member|administrator)/ })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Set organization location', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate invite code', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('Ask an administrator for an invitation to share.', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a creator with a member role has no administrator controls', async ({ page }) => {
  const errors = await backend(page, { organizationRole: 'member' });
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await expect(
    page.getByRole('button', { name: 'Set organization location', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await expect(page.getByText('Alice · You', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Make .* (member|administrator)/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite colleagues', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get invite', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('German organization roles', () => {
  test.use({ locale: 'de-DE' });
  test('member management follows the system language', async ({ page }) => {
    const errors = await backend(page, { differentCreator: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('correct-horse-battery');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('tab', { name: /Dein Team/ }).click();
    await page.getByRole('button', { name: 'Mitglieder & Rollen', exact: true }).click();
    await page.getByRole('button', { name: 'Bob verwalten', exact: true }).click();
    await page.getByRole('button', { name: 'Bob zum Administrator machen', exact: true }).click();
    await expect(page.getByText('2 Mitglieder · 2 Administratoren', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/forkcast-roles-german.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});

test('organization role changes from another administrator refresh the open screen', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { live });
  let role = 'admin';
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/organization_memberships**',
    async (route) => {
      const self = {
        organization_id: orgId,
        user_id: userId,
        role,
        profiles: { display_name: 'Alice' },
      };
      const other = {
        organization_id: orgId,
        user_id: '00000000-0000-0000-0000-000000000002',
        role: 'admin',
        profiles: { display_name: 'Bob' },
      };
      await route.fulfill({
        json: new URL(route.request().url()).searchParams.has('user_id') ? [self] : [self, other],
      });
    },
  );
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage Alice', exact: true })).toBeVisible();
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  role = 'member';
  live.emit!('organization');
  await expect(page.getByRole('button', { name: 'Manage Alice', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Set organization location', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('2 members · 1 administrator', { exact: true })).toBeVisible();
  role = 'admin';
  live.emit!('organization');
  await expect(page.getByRole('button', { name: 'Manage Alice', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Set organization location', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('administrators remove members after confirmation and clear the old invitation', async ({
  page,
}) => {
  const errors = await backend(page);
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Invite colleagues', exact: true }).click();
  await page.getByRole('button', { name: 'Get invite', exact: true }).click();
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await page.getByRole('button', { name: 'Manage Bob', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from organization', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove member?', exact: true });
  await expect(dialog.getByText(/The invitation code will be rotated/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from organization', exact: true }).click();
  const request = page.waitForRequest('**/rpc/remove_organization_member');
  await dialog.getByRole('button', { name: 'Remove access', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({
    org: orgId,
    member: '00000000-0000-0000-0000-000000000002',
  });
  await expect(page.getByText('1 member · 1 administrator', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage Bob', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rotate invite code', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Leave organization', exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test('a member can leave their only organization and return to joining or creating a group', async ({
  page,
}) => {
  const errors = await backend(page, { organizationRole: 'member' });
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await page.getByRole('button', { name: 'Leave organization', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave Office team?', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Alice · You', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave organization', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm leaving', exact: true }).click();
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join organization', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('leaving the selected organization switches to another membership', async ({ page }) => {
  const errors = await backend(page, { organizationRole: 'member', multipleOrganizations: true });
  await signIn(page, 'Overview');
  await page.getByRole('tab', { name: /Your team/ }).click();
  await page.getByRole('button', { name: 'Members & roles', exact: true }).click();
  await page.getByRole('button', { name: 'Leave organization', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm leaving', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Switch organization. Current: Other team', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Switch organization. Current: Other team', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('a private membership signal clears a revoked organization even though its group signal is inaccessible', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { live });
  await signIn(page, 'Overview');
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  await page.route('https://forkcast-test.supabase.co/rest/v1/organizations**', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/organization_memberships**',
    (route) => route.fulfill({ json: [] }),
  );
  live.emit!('membership');
  await expect(page.getByText('Pull up a chair.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German member management', () => {
  test.use({ locale: 'de-DE' });
  test('removal and leaving dialogs follow the system language', async ({ page }) => {
    const errors = await backend(page);
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('tab', { name: /Dein Team/ }).click();
    await page.getByRole('button', { name: 'Mitglieder & Rollen', exact: true }).click();
    await page.getByRole('button', { name: 'Bob verwalten', exact: true }).click();
    await page.getByRole('button', { name: 'Aus Organisation entfernen', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Mitglied entfernen?', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Zugriff entziehen', exact: true }).click();
    await expect(page.getByText('1 Mitglied · 1 Administrator', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Organisation verlassen', exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: '/tmp/forkcast-members-german.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});

test('the no-organization screen picks up a membership created on another device', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { group: false, live });
  await signIn(page, 'Overview');
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  await page.route('https://forkcast-test.supabase.co/rest/v1/organizations**', (route) =>
    route.fulfill({ json: [org] }),
  );
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/organization_memberships**',
    (route) =>
      route.fulfill({
        json: [
          {
            organization_id: orgId,
            user_id: userId,
            role: 'member',
            profiles: { display_name: 'Alice' },
          },
        ],
      }),
  );
  live.emit!('membership');
  await expect(page.getByRole('tab', { name: /Overview/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Switch organization. Current: Office team', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('straight-line distances support nearest sorting, shared distance filtering and the fallback wheel', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, office: true });
  const places = [
    {
      id: 'osm:node:1',
      provider: 'osm',
      name: 'Miso Kitchen',
      address: 'Berlin',
      category: 'Japanese restaurant',
      latitude: 52.52,
      longitude: 13.4,
      types: ['restaurant', 'cuisine:japanese'],
      hours: [],
      attributions: [],
    },
    {
      id: 'osm:node:2',
      provider: 'osm',
      name: 'Nearby Cafe',
      address: 'Berlin',
      category: 'Cafe',
      latitude: 52.52,
      longitude: 13.395,
      types: ['cafe'],
      hours: [],
      attributions: [],
    },
  ];
  await page.route('https://forkcast-test.supabase.co/rest/v1/place_ratings**', (route) =>
    route.fulfill({
      json: places.map((place, i) => ({
        place_id: place.id,
        organization_id: orgId,
        average: i ? 3 : 5,
        count: 1,
      })),
    }),
  );
  await page.route('https://forkcast-test.supabase.co/functions/v1/places', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== 'details') return route.fallback();
    await route.fulfill({
      json: {
        places: places.filter((place) => body.ids.includes(place.id)),
        failed: [],
        warning: '',
      },
    });
  });
  await signIn(page);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await expect(page.getByText('680 m · straight line', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sort: Best rated', exact: true }).click();
  await page.getByRole('radio', { name: 'Nearest first', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Read reviews', exact: true }).first(),
  ).toContainText('Nearby Cafe');
  await page.getByRole('button', { name: 'Distance: Any distance', exact: true }).click();
  await page.getByRole('radio', { name: 'Within 500 m', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toHaveCount(1);
  await page.getByRole('radio', { name: 'Map view', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Miso Kitchen, 5.0 stars', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Nearby Cafe, 3.0 stars', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Overview/ }).click();
  await page.getByRole('radio', { name: "I'm going out", exact: true }).click();
  await page.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Spin the wheel', exact: true });
  await expect(picker.getByText('Distance: Within 500 m', { exact: false })).toBeVisible();
  await expect(picker.getByText('Picking from 1 restaurant', { exact: true })).toBeVisible();
  const spin = page.waitForRequest('**/rpc/spin_lunch_wheel');
  await picker.getByRole('button', { name: 'Spin the wheel', exact: true }).click();
  expect((await spin).postDataJSON().candidate_ids).toEqual(['osm:node:2']);
  await expect(picker.getByText('Wheel result: Nearby Cafe', { exact: true })).toBeVisible();
  await picker.getByRole('button', { name: 'Close restaurant picker', exact: true }).click();
  expect(errors).toEqual([]);
});

test('distance availability handles missing offices and appears in favorites and place details', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true, office: true, favorited: true });
  await signIn(page);
  await page.getByRole('radio', { name: 'Favorites view', exact: true }).click();
  await expect(page.getByText('680 m · straight line', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'View Miso Kitchen', exact: true }).click();
  await expect(
    page.getByLabel('Straight-line distance from office: 680 m', { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Distance: Any distance', exact: true }).click();
  await page.getByRole('radio', { name: 'Within 500 m', exact: true }).click();
  await expect(page.getByText('No spots match', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German straight-line distances', () => {
  test.use({ locale: 'de-DE' });
  test('distance labels and controls follow system language', async ({ page }) => {
    const errors = await backend(page, { office: true, reviewed: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page.getByRole('tab', { name: /Restaurants/ }).click();
    await page.getByRole('radio', { name: 'Listenansicht', exact: true }).click();
    await expect(page.getByText('680 m · Luftlinie', { exact: true }).first()).toBeVisible();
    await page
      .getByRole('button', { name: 'Entfernung: Beliebige Entfernung', exact: true })
      .click();
    await page.getByRole('radio', { name: 'Bis 1 km', exact: true }).click();
    await page.screenshot({ path: '/tmp/forkcast-distance-german.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});

test('places without an office location keep their list and cannot use nearest or distance limits', async ({
  page,
}) => {
  const errors = await backend(page, { reviewed: true });
  await signIn(page);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Distance: Any distance', exact: true }).click();
  await expect(
    page.getByText('Set an office location to calculate distances.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Within 500 m', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Any distance', exact: true }).click();
  await page.getByRole('button', { name: 'Sort: Best rated', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Nearest first', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Best rated', exact: true }).click();
  await page.getByRole('button', { name: 'Read reviews', exact: true }).click();
  await expect(
    page.getByText('Set an office location to calculate distances.', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('distance limits recalculate automatically when the office location changes', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { reviewed: true, office: true, live });
  await signIn(page);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Distance: Any distance', exact: true }).click();
  await page.getByRole('radio', { name: 'Within 500 m', exact: true }).click();
  await expect(page.getByText('No spots match', { exact: true })).toBeVisible();
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  await page.route('https://forkcast-test.supabase.co/rest/v1/organizations**', (route) =>
    route.fulfill({
      json: [{ ...org, latitude: 52.52, longitude: 13.395, location_label: 'Closer office' }],
    }),
  );
  live.emit!('organization');
  await expect(page.getByRole('button', { name: 'Read reviews', exact: true })).toBeVisible();
  await expect(page.getByText('340 m · straight line', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('legacy places without coordinates show an unavailable distance instead of zero', async ({
  page,
}) => {
  const errors = await backend(page, { legacy: true, office: true });
  await signIn(page);
  await page.getByRole('radio', { name: 'List view', exact: true }).click();
  await page.getByRole('button', { name: 'Read reviews', exact: true }).click();
  await expect(
    page.getByText('Distance unavailable for this place.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('0 m · straight line', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('group orders collect choices, mark readiness and select Ordering in', async ({ page }) => {
  const errors = await backend(page, { groupOrder: true, nonOrderOrganizer: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View order from Team pizza', exact: true }).click();
  await page.getByLabel('Item name 1', { exact: true }).fill('Margherita');
  await page.getByLabel('Unit price 1 (€)', { exact: true }).fill('8.50');
  await page.getByLabel('Special requests 1', { exact: true }).fill('No olives');
  await page.getByRole('button', { name: 'Ready to order', exact: true }).click();
  const saved = page.waitForRequest('**/rpc/save_office_order_items');
  await page.getByRole('button', { name: 'Save my order', exact: true }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    is_ready: true,
    expected_revision: 0,
    items: [{ item_name: 'Margherita', quantity: 1, unit_cents: 850, notes: 'No olives' }],
  });
  await expect(page.getByRole('button', { name: 'Edit my items', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Go back', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: "I'm ordering food to the office", exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});

test('an organizer locks the combined order, finalizes fees, confirms payment and announces arrival', async ({
  page,
}) => {
  const errors = await backend(page, { groupOrder: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View order from Team pizza', exact: true }).click();
  await page.getByRole('button', { name: 'Copy combined order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Order copied', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close order for changes', exact: true }).click();
  await page.getByLabel('Final delivery fee (€)', { exact: true }).fill('3.00');
  await page.getByRole('button', { name: 'Mark order placed', exact: true }).click();
  const placed = page.waitForRequest('**/rpc/update_office_order');
  await page
    .getByRole('dialog', { name: 'Confirm order placed', exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  expect((await placed).postDataJSON()).toMatchObject({ new_status: 'placed', fee_cents: 300 });
  await page.getByRole('button', { name: 'People & payments', exact: true }).click();
  await expect(page.getByText('€11.50 · Unpaid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm payment from Bob', exact: true }).click();
  await expect(page.getByText('€11.50 · Payment confirmed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Food has arrived', exact: true }).click();
  await expect(page.getByText(/Food has arrived/).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/forkcast-order-organizer.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('office order payment reminders remain alerts and open the correct order', async ({
  page,
}) => {
  const errors = await backend(page, {
    groupOrder: true,
    nonOrderOrganizer: true,
    orderParticipant: true,
    orderStatus: 'placed',
  });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dismiss notification', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View group order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark as paid', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Organizer checkout', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Mark as paid', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Notifications: 0 unread', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('start a group order with menu and deadline, and expired signups show read-only choices', async ({
  page,
}) => {
  const errors = await backend(page);
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Start group order', exact: true }).click();
  await page.getByLabel('Restaurant', { exact: true }).fill('Team sushi');
  await page.getByLabel('Menu link', { exact: true }).fill('https://example.invalid/menu');
  const created = page.waitForRequest('**/rpc/create_office_order_for_member');
  await page.getByRole('button', { name: 'Start group order', exact: true }).click();
  expect((await created).postDataJSON().restaurant_name).toBe('Team sushi');
  await expect(page.getByRole('button', { name: 'Open menu', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('German group orders', () => {
  test.use({ locale: 'de-DE' });
  test('item entry and readiness follow system language', async ({ page }) => {
    const errors = await backend(page, { groupOrder: true, nonOrderOrganizer: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page
      .getByRole('button', { name: 'Bestellung bei Team pizza ansehen', exact: true })
      .click();
    await page.getByLabel('Artikelname 1', { exact: true }).fill('Pizza');
    await page.getByLabel('Einzelpreis 1 (€)', { exact: true }).fill('8,50');
    await page.getByRole('button', { name: 'Bereit zum Bestellen', exact: true }).click();
    await page.getByRole('button', { name: 'Meine Bestellung speichern', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Meine Artikel bearbeiten', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: '/tmp/forkcast-order-german.png', fullPage: true });
    expect(errors).toEqual([]);
  });
});

test('order deadlines automatically close item editing while the screen stays open', async ({
  page,
}) => {
  const errors = await backend(page, {
    groupOrder: true,
    nonOrderOrganizer: true,
    orderDeadline: new Date(Date.now() + 5000).toISOString(),
  });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View order from Team pizza', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save my order', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save my order', exact: true })).toHaveCount(0, {
    timeout: 8000,
  });
  await expect(page.getByText('This order is closed for changes', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a scheduled deadline reminder updates the header without opening the inbox', async ({
  page,
}) => {
  const errors = await backend(page, {
    groupOrder: true,
    orderParticipant: true,
    nonOrderOrganizer: true,
  });
  const at = new Date(Date.now() + 5000).toISOString();
  await page.route('https://forkcast-test.supabase.co/rest/v1/rpc/notification_inbox', (route) => {
    const due = Date.now() >= Date.parse(at);
    return route.fulfill({
      json: {
        unread: due ? 1 : 0,
        items: due
          ? [
              {
                id: 'timed-order-reminder',
                event_id: null,
                order_id: '40000000-0000-0000-0000-000000000001',
                kind: 'order_deadline',
                title: 'Team pizza',
                meal_date: localDate(),
                actor_name: 'Bob',
                price_cents: 0,
                portions: 1,
                read_at: null,
              },
            ]
          : [],
        next_update_at: due ? null : at,
      },
    });
  });
  await signIn(page, 'Overview');
  await expect(
    page.getByRole('button', { name: 'Notifications: 0 unread', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Notifications: 1 unread', exact: true }),
  ).toBeVisible({ timeout: 8000 });
  expect(errors).toEqual([]);
});

test('the order starter can select another colleague to place the order', async ({ page }) => {
  const errors = await backend(page);
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'Start group order', exact: true }).click();
  await page.getByRole('button', { name: 'Person placing the order: Alice', exact: true }).click();
  await page.getByRole('radio', { name: 'Bob', exact: true }).click();
  await page.getByLabel('Restaurant', { exact: true }).fill('Shared pizza');
  await page.getByLabel('Menu link', { exact: true }).fill('https://example.invalid/menu');
  const request = page.waitForRequest('**/rpc/create_office_order_for_member');
  await page.getByRole('button', { name: 'Start group order', exact: true }).click();
  expect((await request).postDataJSON().organizer).toBe('00000000-0000-0000-0000-000000000002');
  await expect(page.getByText('Organized by Bob', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Close order for changes', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('live order changes preserve drafts and keep the original revision for stale-save protection', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, {
    groupOrder: true,
    nonOrderOrganizer: true,
    orderParticipant: true,
    live,
  });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View order from Team pizza', exact: true }).click();
  await page.getByRole('button', { name: 'Edit my items', exact: true }).click();
  await page.getByLabel('Quantity 1', { exact: true }).fill('2');
  await page.route('https://forkcast-test.supabase.co/rest/v1/office_order_members**', (route) =>
    route.fulfill({
      json: [
        {
          order_id: '40000000-0000-0000-0000-000000000001',
          user_id: userId,
          ready: false,
          revision: 2,
          total_cents: null,
          paid: false,
          payment_confirmed_at: null,
          profiles: { id: userId, display_name: 'Alice' },
        },
      ],
    }),
  );
  await expect.poll(() => live.joins ?? 0).toBeGreaterThan(0);
  const reloaded = page.waitForRequest('**/office_order_members**');
  live.emit!('orders');
  await reloaded;
  await expect(page.getByText('0 of 1 people ready', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Quantity 1', { exact: true })).toHaveValue('2');
  await page.route(
    'https://forkcast-test.supabase.co/rest/v1/rpc/save_office_order_items',
    (route) =>
      route.fulfill({
        status: 400,
        json: { code: 'P0001', message: 'Your order changed. Reload before saving.' },
      }),
  );
  const save = page.waitForRequest('**/rpc/save_office_order_items');
  await page.getByRole('button', { name: 'Save my order', exact: true }).click();
  expect((await save).postDataJSON().expected_revision).toBe(1);
  await page.getByRole('button', { name: 'Load latest order', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Load latest order?', exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Edit my items', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('cooking comments can be posted, edited and deleted without reserving portions', async ({
  page,
}) => {
  const errors = await backend(page, { roster: true, nonOrganizer: true });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Post comment', exact: true })).toBeDisabled();
  await page.getByLabel('Your comment', { exact: true }).fill('Does this contain nuts?');
  await page.route('**/rpc/save_cooking_comment', (route) =>
    route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }),
  );
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Temporarily unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your comment', { exact: true })).toHaveValue(
    'Does this contain nuts?',
  );
  await page.unroute('**/rpc/save_cooking_comment');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByText('Does this contain nuts?', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your comment', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Edit comment', exact: true }).click();
  await page.getByLabel('Edit your comment', { exact: true }).fill('Can I have two portions?');
  await page.getByRole('button', { name: 'Save comment', exact: true }).click();
  await expect(page.getByText('Can I have two portions?', { exact: true })).toBeVisible();
  await expect(page.getByText('Does this contain nuts?', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Can I have two portions?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete comment', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect(
    page.getByText('No comments yet. Start the conversation.', { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('cooking comments paginate and refresh colleagues replies without replacing a draft', async ({
  page,
}) => {
  const live: LiveHarness = {};
  const errors = await backend(page, { roster: true, nonOrganizer: true, live });
  const thread = Array.from({ length: 25 }, (_, index) => ({
    id: `colleague-comment-${index}`,
    event_id: '20000000-0000-0000-0000-000000000001',
    author_id: 'bob',
    body: `Question ${index + 1}`,
    created_at: new Date(Date.UTC(2026, 9, 14, 10, index)).toISOString(),
    edited_at: null,
    profiles: { id: 'bob', display_name: 'Bob' },
  }));
  await page.route('**/rest/v1/cooking_comments**', (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 21);
    return route.fulfill({ json: [...thread].reverse().slice(offset, offset + limit) });
  });
  await signIn(page, 'Overview');
  await page.getByRole('button', { name: 'View lunch & portions', exact: true }).click();
  await expect(page.getByText('Question 25', { exact: true })).toBeVisible();
  await expect(page.getByText('Question 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit comment', exact: true })).toHaveCount(0);
  await page.getByLabel('Your comment', { exact: true }).fill('My unfinished payment question');
  await page.getByRole('button', { name: 'Show earlier comments', exact: true }).click();
  await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show earlier comments', exact: true }),
  ).toHaveCount(0);
  thread[24].body = 'The payment link is in the event.';
  live.emit!('cooking');
  await expect(page.getByText('The payment link is in the event.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your comment', { exact: true })).toHaveValue(
    'My unfinished payment question',
  );
  expect(errors).toEqual([]);
});

test.describe('German cooking comments', () => {
  test.use({ locale: 'de-DE', colorScheme: 'dark' });
  test('questions and editing are translated in the system theme', async ({ page }) => {
    const errors = await backend(page, { roster: true });
    await page.goto('/');
    await page.getByLabel('E-Mail', { exact: true }).fill('alice@example.test');
    await page.getByLabel('Passwort', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
    await page
      .getByRole('button', { name: 'Mittagessen & Portionen ansehen', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Fragen & Kommentare', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Dein Kommentar', { exact: true }).fill('Sind Nüsse enthalten?');
    await page.getByRole('button', { name: 'Kommentar senden', exact: true }).click();
    await expect(page.getByText('Sind Nüsse enthalten?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Kommentar bearbeiten', exact: true }).click();
    await expect(page.getByLabel('Deinen Kommentar bearbeiten', { exact: true })).toHaveValue(
      'Sind Nüsse enthalten?',
    );
    await page.getByRole('button', { name: 'Bearbeitung abbrechen', exact: true }).click();
    await expect(page.getByLabel('Dein Kommentar', { exact: true })).toHaveValue('');
    await page
      .getByRole('heading', { name: 'Fragen & Kommentare', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/forkcast-comments-german.png' });
    expect(errors).toEqual([]);
  });
});
