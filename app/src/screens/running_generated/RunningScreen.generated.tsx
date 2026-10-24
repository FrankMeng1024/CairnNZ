import React from 'react';
import { View, Text, Image, TouchableOpacity, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { svgByAsset } from './svgIcons';
import { cairnText } from '../../i18n/runtime';

// Auto-generated from Running.spec.json  viewport 375x812
// States: R0, R1, R2, R3, R4

type RunningState = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

export function RunningScreen(props: { state?: RunningState; initial?: string } = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'R0';
  const initial = props.initial ?? '?';
  return (
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'R0' && (
        <>
          <Image source={require('../../../assets/running/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{cairnText('running-generated.running-screen-generated.2-48-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'00:32:10'}</Text>
            <Text style={styles.shared__stats_strip__stat_pace}>{cairnText('running-generated.running-screen-generated.5-12-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{cairnText('running-generated.running-screen-generated.gps')}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/running/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('running-generated.running-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/running/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('running-generated.running-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/running/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('running-generated.running-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/running/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('running-generated.running-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R0__free_run_pill}>
            <Text style={styles.R0__free_run_pill__pill_eyebrow}>{cairnText('running-generated.running-screen-generated.free-run')}</Text>
            <Text style={styles.R0__free_run_pill__pill_sub}>{cairnText('running-generated.running-screen-generated.explore-freely')}</Text>
            <Text style={styles.R0__free_run_pill__pill_chev}>{'⌃'}</Text>
          </View>
          <View style={styles.R0__route_row}>
            <Text style={styles.R0__route_row__route_lbl}>{cairnText('running-generated.running-screen-generated.route-none')}</Text>
            <Text style={styles.R0__route_row__route_chev}>{'›'}</Text>
          </View>
          <TouchableOpacity style={styles.R0__start_running_btn} onPress={() => nav.navigate('Running' as never)}>
            <Text style={styles.R0__start_running_btn_label}>{cairnText('running-generated.running-screen-generated.start-running')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'R1' && (
        <>
          <Image source={require('../../../assets/running/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{cairnText('running-generated.running-screen-generated.2-48-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'00:32:10'}</Text>
            <Text style={styles.shared__stats_strip__stat_pace}>{cairnText('running-generated.running-screen-generated.5-12-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{cairnText('running-generated.running-screen-generated.gps')}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/running/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('running-generated.running-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/running/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('running-generated.running-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/running/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('running-generated.running-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/running/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('running-generated.running-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R1__fab_compass}>
            <Text style={styles.R1__fab_compass__compass_glyph}>{'◎'}</Text>
          </View>
          <View style={styles.R1__fab_layers}>
            <Text style={styles.R1__fab_layers__layers_glyph}>{'◇'}</Text>
          </View>
        </>
      )}
      {state === 'R2' && (
        <>
          <Image source={require('../../../assets/running/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{cairnText('running-generated.running-screen-generated.2-48-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'00:32:10'}</Text>
            <Text style={styles.shared__stats_strip__stat_pace}>{cairnText('running-generated.running-screen-generated.5-12-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{cairnText('running-generated.running-screen-generated.gps')}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/running/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('running-generated.running-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/running/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('running-generated.running-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/running/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('running-generated.running-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/running/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('running-generated.running-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R2__action_pause}>
            <Text style={styles.R2__action_pause__pause_glyph}>{cairnText('running-generated.running-screen-generated.ii')}</Text>
          </View>
          <View style={styles.R2__action_cairn}>
            <Image source={require('../../../assets/running/action-leave-cairn.png')} style={styles.R2__action_cairn__cairn_icon} resizeMode="contain" />
          </View>
          <View style={styles.R2__action_lock}>
            <Text style={styles.R2__action_lock__lock_glyph}>{'⌘'}</Text>
          </View>
          <Text style={styles.R2__action_pause_lbl}>{cairnText('running-generated.running-screen-generated.pause')}</Text>
          <Text style={styles.R2__action_cairn_lbl}>{cairnText('running-generated.running-screen-generated.leave-a-cairn')}</Text>
          <Text style={styles.R2__action_lock_lbl}>{cairnText('running-generated.running-screen-generated.lock')}</Text>
        </>
      )}
      {state === 'R3' && (
        <>
          <Image source={require('../../../assets/running/route-preview.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{cairnText('running-generated.running-screen-generated.2-48-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'00:32:10'}</Text>
            <Text style={styles.shared__stats_strip__stat_pace}>{cairnText('running-generated.running-screen-generated.5-12-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{cairnText('running-generated.running-screen-generated.gps')}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/running/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('running-generated.running-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/running/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('running-generated.running-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/running/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('running-generated.running-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/running/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('running-generated.running-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.R3__short_card}>
            <Text style={styles.R3__short_card__short_eyebrow}>{cairnText('running-generated.running-screen-generated.so-close')}</Text>
            <Text style={styles.R3__short_card__short_title}>{cairnText('running-generated.running-screen-generated.your-run-went-a-little-short')}</Text>
            <Text style={styles.R3__short_card__short_km}>{'2.48'}</Text>
            <Text style={styles.R3__short_card__short_km_unit}>{cairnText('running-generated.running-screen-generated.km')}</Text>
            <Text style={styles.R3__short_card__short_time}>{'00:32:10'}</Text>
            <Text style={styles.R3__short_card__short_pace}>{cairnText('running-generated.running-screen-generated.5-12-km-avg-pace')}</Text>
          </View>
          <TouchableOpacity style={styles.R3__short_cta} onPress={() => nav.navigate('Running' as never)}>
            <Text style={styles.R3__short_cta_label}>{cairnText('running-generated.running-screen-generated.keep-going-a-little-longer')}</Text>
          </TouchableOpacity>
          <Text style={styles.R3__short_secondary}>{cairnText('running-generated.running-screen-generated.save-anyway')}</Text>
        </>
      )}
      {state === 'R4' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F9F6F3' }} />
          <View style={styles.shared__stats_strip}>
            <Text style={styles.shared__stats_strip__stat_km}>{cairnText('running-generated.running-screen-generated.2-48-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_time}>{'00:32:10'}</Text>
            <Text style={styles.shared__stats_strip__stat_pace}>{cairnText('running-generated.running-screen-generated.5-12-km')}</Text>
            <Text style={styles.shared__stats_strip__stat_gps}>{cairnText('running-generated.running-screen-generated.gps')}</Text>
          </View>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/running/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_trails_label}>{cairnText('running-generated.running-screen-generated.trails')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/running/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_friends_label}>{cairnText('running-generated.running-screen-generated.friends')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/running/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_memory_label}>{cairnText('running-generated.running-screen-generated.memory')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/running/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
              <Text style={styles.shared__tab_bar__tab_settings_label}>{cairnText('running-generated.running-screen-generated.settings')}</Text>
            </TouchableOpacity>
          </View>
          <Image source={require('../../../assets/running/run-complete-hero.png')} style={styles.R4__complete_hero} resizeMode="contain" />
          <Text style={styles.R4__complete_title}>{cairnText('running-generated.running-screen-generated.run-complete')}</Text>
          <View style={styles.R4__complete_stats_row}>
            <Text style={styles.R4__complete_stats_row__stat1_val}>{'5.20'}</Text>
            <Text style={styles.R4__complete_stats_row__stat1_lbl}>{cairnText('running-generated.running-screen-generated.km')}</Text>
            <Text style={styles.R4__complete_stats_row__stat2_val}>{'27:04'}</Text>
            <Text style={styles.R4__complete_stats_row__stat2_lbl}>{cairnText('running-generated.running-screen-generated.time')}</Text>
            <Text style={styles.R4__complete_stats_row__stat3_val}>{'5:12'}</Text>
            <Text style={styles.R4__complete_stats_row__stat3_lbl}>{cairnText('running-generated.running-screen-generated.avg-km')}</Text>
          </View>
          <TouchableOpacity style={styles.R4__save_run_btn} onPress={() => nav.navigate('Home' as never)}>
            <Text style={styles.R4__save_run_btn_label}>{cairnText('running-generated.running-screen-generated.save-run')}</Text>
          </TouchableOpacity>
          <Text style={styles.R4__discard_secondary}>{cairnText('running-generated.running-screen-generated.discard')}</Text>
        </>
      )}
    </View>
  );
}
