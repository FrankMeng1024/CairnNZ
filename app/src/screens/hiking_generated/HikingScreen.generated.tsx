import React from 'react';
import { View, Text, Image, TouchableOpacity, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { svgByAsset } from './svgIcons';

// Auto-generated from Hiking.spec.json  viewport 375x812
// States: H0, H1, H2, H3, H4

type HikingState = 'H0' | 'H1' | 'H2' | 'H3' | 'H4';

export function HikingScreen(props: { state?: HikingState; initial?: string } = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'H0';
  const initial = props.initial ?? '?';
  return (
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'H0' && (
        <>
          <Image source={require('../../../assets/hiking/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{'2.48 km'}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'01:20:15'}</Text>
            <Text style={styles.shared__stats_strip__stat_elev}>{'↑ 156 m'}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{'● GPS'}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/hiking/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/hiking/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/hiking/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/hiking/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.H0__free_hike_pill}>
            <Text style={styles.H0__free_hike_pill__pill_eyebrow}>{'FREE HIKE'}</Text>
            <Text style={styles.H0__free_hike_pill__pill_sub}>{'Explore freely'}</Text>
            <Text style={styles.H0__free_hike_pill__pill_chev}>{'⌃'}</Text>
          </View>
          <View style={styles.H0__route_row}>
            <Text style={styles.H0__route_row__route_lbl}>{'Route: None'}</Text>
            <Text style={styles.H0__route_row__route_chev}>{'›'}</Text>
          </View>
          <TouchableOpacity style={styles.H0__start_hiking_btn} onPress={() => nav.navigate('Hiking' as never)}>
            <Text style={styles.H0__start_hiking_btn_label}>Start Hiking</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'H1' && (
        <>
          <Image source={require('../../../assets/hiking/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{'2.48 km'}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'01:20:15'}</Text>
            <Text style={styles.shared__stats_strip__stat_elev}>{'↑ 156 m'}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{'● GPS'}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/hiking/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/hiking/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/hiking/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/hiking/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.H1__fab_compass}>
            <Text style={styles.H1__fab_compass__compass_glyph}>{'◎'}</Text>
          </View>
          <View style={styles.H1__fab_layers}>
            <Text style={styles.H1__fab_layers__layers_glyph}>{'◇'}</Text>
          </View>
        </>
      )}
      {state === 'H2' && (
        <>
          <Image source={require('../../../assets/hiking/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{'2.48 km'}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'01:20:15'}</Text>
            <Text style={styles.shared__stats_strip__stat_elev}>{'↑ 156 m'}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{'● GPS'}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/hiking/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/hiking/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/hiking/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/hiking/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.H2__action_pause}>
            <Text style={styles.H2__action_pause__pause_glyph}>{'II'}</Text>
          </View>
          <View style={styles.H2__action_cairn}>
            <Image source={require('../../../assets/hiking/action-leave-cairn.png')} style={styles.H2__action_cairn__cairn_icon} resizeMode="contain" />
          </View>
          <View style={styles.H2__action_lock}>
            <Text style={styles.H2__action_lock__lock_glyph}>{'⌘'}</Text>
          </View>
          <Text style={styles.H2__action_pause_lbl}>{'Pause'}</Text>
          <Text style={styles.H2__action_cairn_lbl}>{'Leave a Cairn'}</Text>
          <Text style={styles.H2__action_lock_lbl}>{'Lock'}</Text>
        </>
      )}
      {state === 'H3' && (
        <>
          <Image source={require('../../../assets/hiking/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{'2.48 km'}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'01:20:15'}</Text>
            <Text style={styles.shared__stats_strip__stat_elev}>{'↑ 156 m'}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{'● GPS'}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/hiking/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/hiking/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/hiking/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/hiking/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.H3__short_card}>
            <Text style={styles.H3__short_card__short_eyebrow}>{'SO CLOSE'}</Text>
            <Text style={styles.H3__short_card__short_title}>{'You went a little short'}</Text>
            <Text style={styles.H3__short_card__short_km}>{'2.48'}</Text>
            <Text style={styles.H3__short_card__short_km_unit}>{'km'}</Text>
            <Text style={styles.H3__short_card__short_time}>{'01:20:15'}</Text>
            <Text style={styles.H3__short_card__short_elev}>{'↑ 156 m elevation'}</Text>
          </View>
          <TouchableOpacity style={styles.H3__short_cta} onPress={() => nav.navigate('Hiking' as never)}>
            <Text style={styles.H3__short_cta_label}>Keep going a little longer</Text>
          </TouchableOpacity>
          <Text style={styles.H3__short_secondary}>{'Save Anyway'}</Text>
        </>
      )}
      {state === 'H4' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F9F6F3' }} />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{'2.48 km'}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'01:20:15'}</Text>
            <Text style={styles.shared__stats_strip__stat_elev}>{'↑ 156 m'}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{'● GPS'}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/hiking/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/hiking/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/hiking/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/hiking/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Image source={require('../../../assets/hiking/hike-complete-hero.png')} style={styles.H4__complete_hero} resizeMode="contain" />
          <Text style={styles.H4__complete_title}>{'Hike Complete'}</Text>
          <View style={styles.H4__complete_stats_row}>
            <Text style={styles.H4__complete_stats_row__stat1_val}>{'12.6'}</Text>
            <Text style={styles.H4__complete_stats_row__stat1_lbl}>{'km'}</Text>
            <Text style={styles.H4__complete_stats_row__stat2_val}>{'4:22'}</Text>
            <Text style={styles.H4__complete_stats_row__stat2_lbl}>{'time'}</Text>
            <Text style={styles.H4__complete_stats_row__stat3_val}>{'486'}</Text>
            <Text style={styles.H4__complete_stats_row__stat3_lbl}>{'m elev'}</Text>
          </View>
          <TouchableOpacity style={styles.H4__save_hike_btn} onPress={() => nav.navigate('Home' as never)}>
            <Text style={styles.H4__save_hike_btn_label}>Save Hike</Text>
          </TouchableOpacity>
          <Text style={styles.H4__discard_secondary}>{'Discard'}</Text>
        </>
      )}
    </View>
  );
}
