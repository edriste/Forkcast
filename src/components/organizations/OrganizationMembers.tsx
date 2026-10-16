import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { message, supabase } from '../../lib/supabase';
import { useSession } from '../../providers/Auth';
import { useAutomaticRefresh } from '../../providers/LiveUpdates';
import { useLocale } from '../../providers/Locale';
import { useOrganizations } from '../../providers/Organizations';
import { Button, Field, Notice, useAction, useTheme } from '../ui';
import { Dialog } from '../ui/Dialog';

type Member = {
  user_id: string;
  role: 'admin' | 'member';
  profiles: { display_name: string } | null;
};

export function OrganizationMembers({ onAccessChanged }: { onAccessChanged?: () => void }) {
  const { t } = useLocale();
  const { styles, colors } = useTheme();
  const orgs = useOrganizations();
  const org = orgs.current!;
  const session = useSession();
  const action = useAction();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [confirmation, setConfirmation] = useState<'remove' | 'leave' | null>(null);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const all: Member[] = [];
      for (let offset = 0; ; offset += 500) {
        if (request !== generation.current) return;
        const { data, error } = await supabase
          .from('organization_memberships')
          .select('user_id,role,profiles(display_name)')
          .eq('organization_id', org.id)
          .order('user_id')
          .range(offset, offset + 499);
        if (error) throw error;
        all.push(...(data as unknown as Member[]));
        if (data.length < 500) break;
      }
      if (request !== generation.current) return;
      setMembers(
        all.sort((a, b) =>
          a.role === b.role
            ? (a.profiles?.display_name ?? '').localeCompare(b.profiles?.display_name ?? '')
            : a.role === 'admin'
              ? -1
              : 1,
        ),
      );
      setError('');
    } catch (e) {
      if (request === generation.current) setError(message(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [org.id]);
  useEffect(() => {
    void reload();
    return () => {
      generation.current++;
    };
  }, [reload]);
  useAutomaticRefresh(() => void reload(), ['organization']);
  const admins = members.filter((member) => member.role === 'admin').length;
  const selectedMember = members.find((member) => member.user_id === selected);
  const selectedMemberName = selectedMember?.profiles?.display_name ?? t('Colleague');
  const selectedIsLastAdmin = selectedMember?.role === 'admin' && admins <= 1;
  const visible = members.filter((member) =>
    (member.profiles?.display_name ?? '')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.subtitle}>
        {t(members.length === 1 ? '1 member' : '{count} members', { count: members.length })}
        {' · '}
        {t(admins === 1 ? '1 administrator' : '{count} administrators', { count: admins })}
      </Text>
      <Text style={styles.subtitle}>
        {t(
          'Administrators manage invitations, office settings and member roles. Keep at least one administrator.',
        )}
      </Text>
      <Notice error={error || action.error} />
      {loading && <Text style={styles.subtitle}>{t('Loading…')}</Text>}
      {error && <Button secondary title={t('Retry')} onPress={reload} />}
      {members.length > 8 && (
        <Field label={t('Search members')} value={query} onChangeText={setQuery} />
      )}
      {visible.map((member) => {
        const name = member.profiles?.display_name ?? t('Colleague');
        const canManage = org.role === 'admin' && !loading && !error;
        return (
          <Pressable
            key={member.user_id}
            accessibilityRole={canManage ? 'button' : undefined}
            accessibilityLabel={canManage ? t('Manage {name}', { name }) : undefined}
            disabled={!canManage || action.busy}
            onPress={() => setSelected(member.user_id)}
            style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.text}>
                {name}
                {member.user_id === session.user.id ? ` · ${t('You')}` : ''}
              </Text>
              <Text style={[styles.subtitle, member.role === 'admin' && { color: colors.accent }]}>
                {member.role === 'admin' ? t('Administrator') : t('Member')}
              </Text>
            </View>
            {canManage && (
              <Ionicons
                name="ellipsis-horizontal"
                size={22}
                color={colors.muted}
                accessible={false}
              />
            )}
          </Pressable>
        );
      })}
      <Button
        secondary
        title={t('Leave organization')}
        busy={action.busy}
        disabled={loading || !!error || (org.role === 'admin' && admins <= 1)}
        onPress={() => setConfirmation('leave')}
      />
      {org.role === 'admin' && admins <= 1 && (
        <Text style={styles.subtitle}>
          {t('Make another member an administrator before leaving.')}
        </Text>
      )}
      <Dialog
        visible={!!selected && confirmation === null}
        title={t('Manage member')}
        closeLabel={t('Close member dialog')}
        busy={action.busy}
        onClose={() => setSelected('')}
      >
        {selectedMember ? (
          <>
            <Text style={styles.heading}>{selectedMemberName}</Text>
            <Text style={styles.subtitle}>
              {selectedMember.role === 'admin' ? t('Administrator') : t('Member')}
            </Text>
            <Notice error={action.error} />
            <Button
              secondary
              title={
                selectedIsLastAdmin
                  ? t('Last administrator')
                  : selectedMember.role === 'admin'
                    ? t('Make member')
                    : t('Make admin')
              }
              accessibilityLabel={
                selectedMember.role === 'admin'
                  ? t('Make {name} a member', { name: selectedMemberName })
                  : t('Make {name} an administrator', { name: selectedMemberName })
              }
              busy={action.busy}
              disabled={selectedIsLastAdmin || org.role !== 'admin' || !!error}
              onPress={() =>
                action.run(async () => {
                  const { error } = await supabase.rpc('set_organization_member_role', {
                    org: org.id,
                    member: selectedMember.user_id,
                    new_role: selectedMember.role === 'admin' ? 'member' : 'admin',
                  });
                  if (error) throw error;
                  setSelected('');
                  await Promise.all([reload(), orgs.reload()]);
                })
              }
            />
            {selectedMember.user_id !== session.user.id && (
              <Button
                secondary
                title={t('Remove from organization')}
                disabled={selectedIsLastAdmin || org.role !== 'admin' || !!error}
                busy={action.busy}
                onPress={() => setConfirmation('remove')}
              />
            )}
          </>
        ) : (
          <Text style={styles.subtitle}>
            {t('This colleague is not a member of this organization')}
          </Text>
        )}
      </Dialog>
      <Dialog
        visible={confirmation !== null}
        title={
          confirmation === 'leave' ? t('Leave {name}?', { name: org.name }) : t('Remove member?')
        }
        closeLabel={t('Close member dialog')}
        busy={action.busy}
        onClose={() => setConfirmation(null)}
      >
        <Text style={styles.text}>
          {confirmation === 'leave'
            ? t(
                'You will lose access to this organization. Your reviews, cooking signups and payment records will stay with the organization.',
              )
            : t(
                '{name} will lose access. Their reviews, cooking signups and payment records will stay. The invitation code will be rotated, so earlier invitations stop working.',
                {
                  name: selectedMemberName,
                },
              )}
        </Text>
        <Notice error={action.error} />
        <Button
          title={confirmation === 'leave' ? t('Confirm leaving') : t('Remove access')}
          busy={action.busy}
          disabled={confirmation === 'remove' && org.role !== 'admin'}
          onPress={() =>
            action.run(async () => {
              const leaving = confirmation === 'leave';
              const { error } = leaving
                ? await supabase.rpc('leave_organization', { org: org.id })
                : await supabase.rpc('remove_organization_member', {
                    org: org.id,
                    member: selected,
                  });
              if (error) throw error;
              setConfirmation(null);
              setSelected('');
              if (leaving) orgs.forget(org.id);
              else onAccessChanged?.();
              await orgs.reload();
              if (!leaving) await reload();
            })
          }
        />
        <Button
          secondary
          title={t('Cancel')}
          disabled={action.busy}
          onPress={() => setConfirmation(null)}
        />
      </Dialog>
      {!loading && !error && !visible.length && (
        <Text style={styles.subtitle}>{t('No members match your search.')}</Text>
      )}
    </View>
  );
}
