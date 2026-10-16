import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { NotificationBell } from './components/notifications/NotificationBell';
import { usePushNavigation } from './components/notifications/usePushNavigation';
import { OrganizationSwitcher } from './components/organizations/OrganizationSwitcher';
import { Loading, useTheme } from './components/ui';
import type { MainTabParams, RootStackParams } from './navigation';
import { useSession } from './providers/Auth';
import { FavoritesProvider } from './providers/Favorites';
import { LiveUpdatesProvider } from './providers/LiveUpdates';
import { useLocale } from './providers/Locale';
import { NotificationsProvider } from './providers/Notifications';
import { useOrganizations } from './providers/Organizations';
import { PlaceFiltersProvider } from './providers/PlaceFilters';
import { CookingScreen } from './screens/CookingScreen';
import { CreateEventScreen } from './screens/CreateEventScreen';
import { CreateOrderScreen } from './screens/CreateOrderScreen';
import { EventScreen } from './screens/EventScreen';
import { OrderScreen } from './screens/OrderScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { OrganizationScreen } from './screens/OrganizationScreen';
import { OverviewScreen } from './screens/OverviewScreen';
import { PlaceScreen } from './screens/PlaceScreen';
import { PlacesScreen } from './screens/PlacesScreen';
import { SearchScreen } from './screens/SearchScreen';
const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<MainTabParams>();
function MainTabs({ initialTab }: { initialTab: keyof MainTabParams }) {
  const { t } = useLocale();

  const { colors } = useTheme();

  return (
    <Tabs.Navigator
      initialRouteName={initialTab}
      screenOptions={({ route, navigation }) => ({
        headerTitle: () => <OrganizationSwitcher onManage={() => navigation.navigate('Profile')} />,
        headerRight: () => (
          <NotificationBell
            onOpen={(eventId, orderId) =>
              orderId
                ? navigation.getParent()?.navigate('Order', { orderId })
                : navigation.getParent()?.navigate('Event', { eventId })
            }
          />
        ),
        headerTintColor: colors.ink,
        headerStyle: { backgroundColor: colors.surface },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontWeight: '600' },
        // Reserve the full pill width when labels move beside icons on wider screens.
        tabBarIconStyle: { width: 48, flexShrink: 0 },
        tabBarIcon: ({ color, size, focused }) => (
          <View
            style={{
              width: 48,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: focused ? colors.orange : 'transparent',
            }}
          >
            <Ionicons
              name={
                route.name === 'Overview'
                  ? focused
                    ? 'home'
                    : 'home-outline'
                  : route.name === 'Places'
                    ? focused
                      ? 'map'
                      : 'map-outline'
                    : route.name === 'Cooking'
                      ? focused
                        ? 'restaurant'
                        : 'restaurant-outline'
                      : focused
                        ? 'people'
                        : 'people-outline'
              }
              size={size}
              color={focused ? colors.onOrange : color}
            />
          </View>
        ),
      })}
    >
      <Tabs.Screen
        name="Overview"
        component={OverviewScreen}
        options={{ tabBarLabel: t('Overview') }}
      />
      <Tabs.Screen name="Places" component={PlacesScreen} options={{ tabBarLabel: t('Places') }} />
      <Tabs.Screen
        name="Cooking"
        component={CookingScreen}
        options={{ tabBarLabel: t('Cooking') }}
      />
      <Tabs.Screen
        name="Profile"
        component={OrganizationScreen}
        options={{ tabBarLabel: t('Your team') }}
      />
    </Tabs.Navigator>
  );
}
export function AppNavigation() {
  const user = useSession().user.id;
  const { t, language } = useLocale();

  const { colors, dark } = useTheme();

  const orgs = useOrganizations();
  const navigation = useNavigationContainerRef<RootStackParams>();
  const [navigationReady, setNavigationReady] = useState(0);
  usePushNavigation(navigation, navigationReady);
  // Keep the selected tab when fresh screens mount for a different organization.
  const activeTab = useRef<keyof MainTabParams>('Overview');
  if (orgs.loading) return <Loading />;
  if (!orgs.current || orgs.pendingInvite) return <OrganizationScreen />;
  return (
    <LiveUpdatesProvider key={orgs.current.id}>
      <PlaceFiltersProvider>
        <FavoritesProvider key={user}>
          <NotificationsProvider>
            <NavigationContainer
              ref={navigation}
              onReady={() => setNavigationReady((value) => value + 1)}
              key={orgs.current.id}
              onStateChange={(state) => {
                const tabs = state?.routes.find((route) => route.name === 'Tabs')?.state;
                const name = tabs?.routes[tabs.index ?? 0]?.name;
                if (name && ['Overview', 'Places', 'Cooking', 'Profile'].includes(name))
                  activeTab.current = name as keyof MainTabParams;
              }}
              theme={{
                ...(dark ? DarkTheme : DefaultTheme),
                colors: {
                  primary: colors.accent,
                  background: colors.cream,
                  card: colors.surface,
                  text: colors.ink,
                  border: colors.line,
                  notification: colors.red,
                },
              }}
            >
              <Stack.Navigator
                screenOptions={({ navigation }) => ({
                  headerRight: () => (
                    <NotificationBell
                      onOpen={(eventId, orderId) =>
                        orderId
                          ? navigation.navigate('Order', { orderId })
                          : navigation.navigate('Event', { eventId })
                      }
                    />
                  ),
                  headerTintColor: colors.ink,
                  headerStyle: { backgroundColor: colors.surface },
                  headerBackTitle: t('Back'),
                  ...(language === 'de'
                    ? {
                        headerBackVisible: false,
                        headerLeft: () =>
                          navigation.canGoBack() ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={t('Back')}
                              onPress={navigation.goBack}
                              style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
                            >
                              <Ionicons name="chevron-back" size={26} color={colors.ink} />
                            </Pressable>
                          ) : null,
                      }
                    : {}),
                })}
              >
                <Stack.Screen name="Tabs" options={{ headerShown: false }}>
                  {() => <MainTabs initialTab={activeTab.current} />}
                </Stack.Screen>
                <Stack.Screen
                  name="Search"
                  component={SearchScreen}
                  options={{ title: t('Search places') }}
                />
                <Stack.Screen
                  name="Place"
                  component={PlaceScreen}
                  getId={({ params }) => params.placeId}
                  options={{ title: t('Lunch spot') }}
                />
                <Stack.Screen
                  name="CreateEvent"
                  component={CreateEventScreen}
                  options={{ title: t('Host a lunch') }}
                />
                <Stack.Screen
                  name="Orders"
                  component={OrdersScreen}
                  options={{ title: t('Office orders') }}
                />
                <Stack.Screen
                  name="CreateOrder"
                  component={CreateOrderScreen}
                  options={{ title: t('Start group order') }}
                />
                <Stack.Screen
                  name="Order"
                  component={OrderScreen}
                  getId={({ params }) => params.orderId}
                  options={{ title: t('Group order') }}
                />
                <Stack.Screen
                  name="Event"
                  component={EventScreen}
                  getId={({ params }) => params.eventId}
                  options={{ title: t('Office lunch') }}
                />
              </Stack.Navigator>
            </NavigationContainer>
          </NotificationsProvider>
        </FavoritesProvider>
      </PlaceFiltersProvider>
    </LiveUpdatesProvider>
  );
}
