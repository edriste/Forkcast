import { useCredits } from '../providers/Credits';
import { useLocale } from '../providers/Locale';
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useOrganizations } from '../providers/Organizations';
import { SearchAreaSettings } from '../components/SearchAreaSettings';
import { OfficeLocationPicker } from '../components/OfficeLocationPicker';
import type { OfficeLocation } from '../lib/types';
import { useSession } from '../providers/Auth';
import { inviteCode } from '../lib/invites';
import { supabase } from '../lib/supabase';
import { Button, Card, Chip, Field, Notice, Page, useAction, useTheme } from '../components/ui';

function OrganizationSection({
  title,
  icon,
  initiallyOpen = false,
  children,
}: React.PropsWithChildren<{
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  initiallyOpen?: boolean;
}>) {
  const { styles, colors } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ gap: open ? 12 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <Ionicons name={icon} size={22} color={colors.accent} accessible={false} />
        <Text style={[styles.heading, { flex: 1 }]}>{title}</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.muted}
          accessible={false}
        />
      </Pressable>
      {open && children}
    </View>
  );
}

export function OrganizationScreen() {
  const { t } = useLocale();

  const { styles, colors } = useTheme();
  const openCredits = useCredits();

  const orgs = useOrganizations();
  const session = useSession();
  const action = useAction();
  const [name, setName] = useState('');
  const [location, setLocation] = useState<OfficeLocation | null>(null);
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState('');
  useEffect(() => {
    if (orgs.pendingInvite) setCode(orgs.pendingInvite);
  }, [orgs.pendingInvite]);
  useEffect(() => {
    setInvite('');
  }, [orgs.current?.id]);
  return (
    <Page>
      <Text style={styles.title}>{orgs.current ? t('Your team') : t('Pull up a chair.')}</Text>
      <Text style={styles.subtitle}>
        {t('Each group has its own places, reviews, and shared lunches.')}
      </Text>
      <Notice error={orgs.error || action.error} />
      {orgs.error && <Button secondary title={t('Reload groups')} onPress={() => orgs.reload()} />}
      {orgs.current && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: colors.light,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons
                name="business-outline"
                size={22}
                color={colors.accent}
                accessible={false}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.heading}>{orgs.current.name}</Text>
              <Text style={styles.subtitle}>
                {orgs.current.location_label ?? orgs.current.search_area}
              </Text>
            </View>
          </View>
          {orgs.current.created_by === session.user.id && <SearchAreaSettings />}
        </Card>
      )}
      <Card>
        {orgs.current && (
          <OrganizationSection
            key={`invite-${orgs.current.id}`}
            title={t('Invite colleagues')}
            icon="person-add-outline"
          >
            {orgs.current.created_by === session.user.id ? (
              <>
                <Button
                  secondary
                  title={t('Get invite')}
                  busy={action.busy}
                  onPress={() =>
                    action.run(async () => {
                      const { data, error } = await supabase.rpc('organization_invite', {
                        org: orgs.current!.id,
                      });
                      if (error) throw error;
                      setInvite(data);
                    })
                  }
                />
                {invite ? (
                  <>
                    <Text selectable style={styles.text}>
                      {invite}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <View style={{ flexGrow: 1, flexBasis: 140 }}>
                        <Button
                          secondary
                          title={t('Copy invite code')}
                          busy={action.busy}
                          onPress={() =>
                            action.run(async () => {
                              await Clipboard.setStringAsync(invite);
                            })
                          }
                        />
                      </View>
                      <View style={{ flexGrow: 1, flexBasis: 140 }}>
                        <Button
                          title={t('Share invite link')}
                          busy={action.busy}
                          onPress={() =>
                            action.run(async () => {
                              await Share.share({
                                message: t(
                                  'Join {0} on Forkcast: forkcast://join?code={1}\nInvite code: {2}',
                                  { 0: orgs.current!.name, 1: invite, 2: invite },
                                ),
                              });
                            })
                          }
                        />
                      </View>
                    </View>
                    <Button
                      secondary
                      title={t('Rotate invite code')}
                      busy={action.busy}
                      onPress={() =>
                        action.run(async () => {
                          const { data, error } = await supabase.rpc('organization_invite', {
                            org: orgs.current!.id,
                            rotate: true,
                          });
                          if (error) throw error;
                          setInvite(data);
                        })
                      }
                    />
                    <Text style={styles.subtitle}>
                      {t('Rotating invalidates earlier invitations.')}
                    </Text>
                  </>
                ) : null}
              </>
            ) : (
              <Text style={styles.subtitle}>
                {t('Ask the group creator for an invitation to share.')}
              </Text>
            )}
          </OrganizationSection>
        )}
        {orgs.organizations.length > 1 && (
          <OrganizationSection title={t('Your organizations')} icon="swap-horizontal-outline">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {orgs.organizations.map((org) => (
                <Chip
                  key={org.id}
                  label={`${org.id === orgs.current?.id ? '✓ ' : ''}${org.name}`}
                  selected={org.id === orgs.current?.id}
                  onPress={() => orgs.select(org.id)}
                />
              ))}
            </View>
          </OrganizationSection>
        )}
        <OrganizationSection
          key={`join-${Boolean(orgs.pendingInvite)}-${Boolean(orgs.current)}`}
          title={t('Join a group')}
          icon="enter-outline"
          initiallyOpen={!orgs.current || !!orgs.pendingInvite}
        >
          <Field
            label={t('Invite code or Forkcast link')}
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
          />
          {orgs.pendingInvite && (
            <Button
              secondary
              title={t('Dismiss invitation')}
              onPress={() => {
                orgs.setPendingInvite('');
                setCode('');
              }}
            />
          )}
          <Button
            title={t('Join organization')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                const parsed = inviteCode(code);
                if (!parsed)
                  throw new Error(
                    'Enter a valid 32-character invite code or Forkcast invite link.',
                  );
                const { data, error } = await supabase.rpc('join_organization', {
                  invite_code: parsed,
                });
                if (error) throw error;
                await orgs.reload(data);
                setCode('');
                orgs.setPendingInvite('');
              })
            }
          />
        </OrganizationSection>
        <OrganizationSection
          key={`create-${Boolean(orgs.current)}`}
          title={t('Start a lunch circle')}
          icon="add-circle-outline"
          initiallyOpen={!orgs.current && !orgs.pendingInvite}
        >
          <Field
            label={t('Organization name')}
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder={t('Your team or office')}
          />
          <OfficeLocationPicker value={location} onChange={setLocation} disabled={action.busy} />
          <Button
            title={t('Create organization')}
            busy={action.busy}
            onPress={() =>
              action.run(async () => {
                if (!name.trim() || !location)
                  throw new Error('Enter a group name and select its location.');
                const { data, error } = await supabase.rpc('create_organization', {
                  org_name: name,
                  area: location.label.slice(0, 120),
                  office_latitude: location.latitude,
                  office_longitude: location.longitude,
                  office_label: location.label,
                });
                if (error) throw error;
                await orgs.reload(data);
                setName('');
                setLocation(null);
              })
            }
          />
        </OrganizationSection>
      </Card>
      <Card>
        <Text style={styles.heading}>{t('Your account')}</Text>
        <Text style={styles.subtitle}>
          {t('Signed in as')} {session.user.email}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Credits & licenses')}
            onPress={openCredits}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={[styles.text, { color: colors.accent }]}>{t('Credits & licenses')}</Text>
          </Pressable>
          {[
            [t('Terms of use'), process.env.EXPO_PUBLIC_TERMS_URL],
            [t('Privacy policy'), process.env.EXPO_PUBLIC_PRIVACY_URL],
          ].map(([label, url]) =>
            url ? (
              <Pressable
                key={label}
                accessibilityRole="link"
                accessibilityLabel={label!}
                style={{ minHeight: 44, justifyContent: 'center' }}
                onPress={() =>
                  action.run(async () => {
                    await Linking.openURL(url);
                  })
                }
              >
                <Text style={[styles.text, { color: colors.accent }]}>{label}</Text>
              </Pressable>
            ) : null,
          )}
        </View>
        <Button
          secondary
          title={t('Sign out')}
          busy={action.busy}
          onPress={() =>
            action.run(async () => {
              const { error } = await supabase.auth.signOut();
              if (error) throw error;
            })
          }
        />
      </Card>
    </Page>
  );
}
