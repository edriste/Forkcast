import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocale } from '../providers/Locale';
import { useOrganizations } from '../providers/Organizations';
import { useSession } from '../providers/Auth';
import { useAutomaticRefresh } from '../providers/LiveUpdates';
import { message, supabase } from '../lib/supabase';
import { Button, Field, Notice, useAction, useTheme } from './ui';

type Member = {
  user_id: string;
  role: 'admin' | 'member';
  profiles: { display_name: string } | null;
};
export function OrganizationMembers() {
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
        const lastAdmin = member.role === 'admin' && admins <= 1;
        return (
          <View
            key={member.user_id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
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
            {org.role === 'admin' && (
              <Button
                secondary
                title={
                  lastAdmin
                    ? t('Last administrator')
                    : member.role === 'admin'
                      ? t('Make member')
                      : t('Make admin')
                }
                accessibilityLabel={
                  member.role === 'admin'
                    ? t('Make {name} a member', { name })
                    : t('Make {name} an administrator', { name })
                }
                busy={action.busy}
                disabled={lastAdmin || loading || !!error}
                onPress={() =>
                  action.run(async () => {
                    const { error } = await supabase.rpc('set_organization_member_role', {
                      org: org.id,
                      member: member.user_id,
                      new_role: member.role === 'admin' ? 'member' : 'admin',
                    });
                    if (error) throw error;
                    await Promise.all([reload(), orgs.reload()]);
                  })
                }
              />
            )}
          </View>
        );
      })}
      {!loading && !error && !visible.length && (
        <Text style={styles.subtitle}>{t('No members match your search.')}</Text>
      )}
    </View>
  );
}
