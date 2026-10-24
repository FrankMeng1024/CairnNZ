import React from 'react';
import { View, Text, Image, TouchableOpacity, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { svgByAsset } from './svgIcons';
import { cairnText } from '../../i18n/runtime';

// Auto-generated from Auth.spec.json  viewport 375x812
// States: A0, A1, A2, A3, A4, A5, A6, R0, R1, R2, R3, PR0, PR1, PR2, OS0, OS1, OS2

type AuthState = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'R0' | 'R1' | 'R2' | 'R3' | 'PR0' | 'PR1' | 'PR2' | 'OS0' | 'OS1' | 'OS2';

export function AuthScreen(props: { state?: AuthState; initial?: string } = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'A0';
  const initial = props.initial ?? '?';
  return (
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'A0' && (
        <>
          <Image source={require('../../../assets/auth/o3-auth-background.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <View style={styles.A0__scrim}>
          </View>
          <Image source={require('../../../assets/auth/o3-cairn-hero.png')} style={styles.A0__hero_cairn} resizeMode="contain" />
          <Text style={styles.A0__wordmark}>{cairnText('auth-generated.auth-screen-generated.cairnnz')}</Text>
          <Text style={styles.A0__tagline}>{cairnText('auth-generated.auth-screen-generated.leave-your-mark-find-your-path')}</Text>
          <TouchableOpacity style={styles.A0__btn_apple} onPress={() => {}}>
            <Text style={styles.A0__btn_apple_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-apple')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.A0__btn_google} onPress={() => {}}>
            <Text style={styles.A0__btn_google_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-google')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.A0__btn_email} onPress={() => {}}>
            <Text style={styles.A0__btn_email_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-email')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'A1' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.A1__back}>{'‹'}</Text>
          <Text style={styles.A1__title}>{cairnText('auth-generated.auth-screen-generated.choose-how')}</Text>
          <Text style={styles.A1__title_2}>{cairnText('auth-generated.auth-screen-generated.you-d-like-to-continue')}</Text>
          <TouchableOpacity style={styles.A1__btn_apple} onPress={() => {}}>
            <Text style={styles.A1__btn_apple_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-apple')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.A1__btn_google} onPress={() => {}}>
            <Text style={styles.A1__btn_google_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-google')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.A1__btn_email} onPress={() => {}}>
            <Text style={styles.A1__btn_email_label}>{cairnText('auth-generated.auth-screen-generated.continue-with-email')}</Text>
          </TouchableOpacity>
          <Text style={styles.A1__signin_link}>{cairnText('auth-generated.auth-screen-generated.already-have-an-account-sign-in-here')}</Text>
        </>
      )}
      {state === 'A2' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.A2__back}>{'‹'}</Text>
          <Text style={styles.A2__title}>{cairnText('auth-generated.auth-screen-generated.create-your-account')}</Text>
          <Text style={styles.A2__subtitle}>{cairnText('auth-generated.auth-screen-generated.let-s-get-started')}</Text>
          <Text style={styles.A2__label_email}>{cairnText('auth-generated.auth-screen-generated.email')}</Text>
          <View style={styles.A2__field_email}>
            <Text style={styles.A2__field_email__ph}>{cairnText('auth-generated.auth-screen-generated.name-example-com')}</Text>
          </View>
          <Text style={styles.A2__label_pass}>{cairnText('auth-generated.auth-screen-generated.password')}</Text>
          <View style={styles.A2__field_pass}>
            <Text style={styles.A2__field_pass__ph}>{cairnText('auth-generated.auth-screen-generated.create-a-password')}</Text>
          </View>
          <Text style={styles.A2__req_1}>{cairnText('auth-generated.auth-screen-generated.at-least-8-characters')}</Text>
          <Text style={styles.A2__req_2}>{cairnText('auth-generated.auth-screen-generated.use-uppercase-letters')}</Text>
          <Text style={styles.A2__req_3}>{cairnText('auth-generated.auth-screen-generated.use-numbers')}</Text>
          <TouchableOpacity style={styles.A2__btn_continue} onPress={() => {}}>
            <Text style={styles.A2__btn_continue_label}>{cairnText('common.continue')}</Text>
          </TouchableOpacity>
          <Text style={styles.A2__signin_link}>{cairnText('auth-generated.auth-screen-generated.already-have-an-account-sign-in-here')}</Text>
        </>
      )}
      {state === 'A3' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.A3__back}>{'‹'}</Text>
          <Image source={require('../../../assets/auth/o3-icon-line-mail.png')} style={styles.A3__icon_mail} resizeMode="contain" />
          <Text style={styles.A3__title}>{cairnText('auth-generated.auth-screen-generated.check-your-email')}</Text>
          <Text style={styles.A3__subtitle}>{cairnText('auth-generated.auth-screen-generated.enter-the-6-digit-code-sent-to')}</Text>
          <Text style={styles.A3__subtitle_2}>{cairnText('auth-generated.auth-screen-generated.name-example-com')}</Text>
          <View style={styles.A3__otp_1}>
          </View>
          <View style={styles.A3__otp_2}>
          </View>
          <View style={styles.A3__otp_3}>
          </View>
          <View style={styles.A3__otp_4}>
          </View>
          <View style={styles.A3__otp_5}>
          </View>
          <View style={styles.A3__otp_6}>
          </View>
          <Text style={styles.A3__resend}>{cairnText('auth-generated.auth-screen-generated.resend-code-in-0-42')}</Text>
          <View style={styles.A3__keypad_1}>
            <Text style={styles.A3__keypad_1__n}>{'1'}</Text>
          </View>
          <View style={styles.A3__keypad_2}>
            <Text style={styles.A3__keypad_2__n}>{'2'}</Text>
          </View>
          <View style={styles.A3__keypad_3}>
            <Text style={styles.A3__keypad_3__n}>{'3'}</Text>
          </View>
          <View style={styles.A3__keypad_4}>
            <Text style={styles.A3__keypad_4__n}>{'4'}</Text>
          </View>
          <View style={styles.A3__keypad_5}>
            <Text style={styles.A3__keypad_5__n}>{'5'}</Text>
          </View>
          <View style={styles.A3__keypad_6}>
            <Text style={styles.A3__keypad_6__n}>{'6'}</Text>
          </View>
          <View style={styles.A3__keypad_7}>
            <Text style={styles.A3__keypad_7__n}>{'7'}</Text>
          </View>
          <View style={styles.A3__keypad_8}>
            <Text style={styles.A3__keypad_8__n}>{'8'}</Text>
          </View>
          <View style={styles.A3__keypad_9}>
            <Text style={styles.A3__keypad_9__n}>{'9'}</Text>
          </View>
          <View style={styles.A3__keypad_0}>
            <Text style={styles.A3__keypad_0__n}>{'0'}</Text>
          </View>
          <View style={styles.A3__keypad_del}>
            <Text style={styles.A3__keypad_del__n}>{'⌫'}</Text>
          </View>
          <TouchableOpacity style={styles.A3__btn_continue} onPress={() => {}}>
            <Text style={styles.A3__btn_continue_label}>{cairnText('common.continue')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'A4' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.A4__back}>{'‹'}</Text>
          <Text style={styles.A4__title}>{cairnText('auth-generated.auth-screen-generated.tell-us-about-yourself')}</Text>
          <Text style={styles.A4__label_name}>{cairnText('auth-generated.auth-screen-generated.display-name')}</Text>
          <View style={styles.A4__field_name}>
            <Text style={styles.A4__field_name__ph}>{cairnText('auth-generated.auth-screen-generated.explorer')}</Text>
          </View>
          <Text style={styles.A4__label_dob}>{cairnText('auth-generated.auth-screen-generated.date-of-birth')}</Text>
          <View style={styles.A4__field_dob}>
            <Text style={styles.A4__field_dob__ph}>{cairnText('auth-generated.auth-screen-generated.dd-mm-yyyy')}</Text>
          </View>
          <TouchableOpacity style={styles.A4__btn_continue} onPress={() => {}}>
            <Text style={styles.A4__btn_continue_label}>{cairnText('common.continue')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'A5' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <View style={styles.A5__check_circle}>
            <Text style={styles.A5__check_circle__tick}>{'✓'}</Text>
          </View>
          <Text style={styles.A5__title}>{cairnText('auth-generated.auth-screen-generated.you-re-all-set')}</Text>
          <Text style={styles.A5__subtitle}>{cairnText('auth-generated.auth-screen-generated.welcome-to-your-world')}</Text>
          <TouchableOpacity style={styles.A5__btn_go} onPress={() => {}}>
            <Text style={styles.A5__btn_go_label}>{cairnText('auth-generated.auth-screen-generated.go-to-home')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'A6' && (
        <>
          <Image source={require('../../../assets/auth/o3-auth-background.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.A6__eyebrow}>{cairnText('auth-generated.auth-screen-generated.your-world')}</Text>
          <Text style={styles.A6__line_1}>{cairnText('auth-generated.auth-screen-generated.you-ve-explored')}</Text>
          <Text style={styles.A6__km}>{cairnText('auth-generated.auth-screen-generated.12-6-km')}</Text>
          <Text style={styles.A6__loc}>{cairnText('auth-generated.auth-screen-generated.new-zealand')}</Text>
        </>
      )}
      {state === 'R0' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.R0__back}>{'‹'}</Text>
          <Text style={styles.R0__title}>{cairnText('auth-generated.auth-screen-generated.welcome-back')}</Text>
          <Text style={styles.R0__subtitle}>{cairnText('auth-generated.auth-screen-generated.glad-to-see-you-again')}</Text>
          <Text style={styles.R0__label_email}>{cairnText('auth-generated.auth-screen-generated.email')}</Text>
          <View style={styles.R0__field_email}>
            <Text style={styles.R0__field_email__ph}>{cairnText('auth-generated.auth-screen-generated.name-example-com')}</Text>
          </View>
          <Text style={styles.R0__label_pass}>{cairnText('auth-generated.auth-screen-generated.password')}</Text>
          <View style={styles.R0__field_pass}>
            <Text style={styles.R0__field_pass__ph}>{cairnText('auth-generated.auth-screen-generated.enter-your-password')}</Text>
          </View>
          <Text style={styles.R0__forgot}>{cairnText('auth-generated.auth-screen-generated.forgot-password')}</Text>
          <TouchableOpacity style={styles.R0__btn_signin} onPress={() => {}}>
            <Text style={styles.R0__btn_signin_label}>{cairnText('auth-generated.auth-screen-generated.sign-in')}</Text>
          </TouchableOpacity>
          <Text style={styles.R0__signup_link}>{cairnText('auth-generated.auth-screen-generated.new-here-create-account')}</Text>
        </>
      )}
      {state === 'R1' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-cairn-hero.png')} style={styles.R1__cairn_hero} resizeMode="contain" />
          <Text style={styles.R1__restoring}>{cairnText('auth-generated.auth-screen-generated.restoring-your-session')}</Text>
        </>
      )}
      {state === 'R2' && (
        <>
          <Image source={require('../../../assets/auth/o3-auth-background.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.R2__eyebrow}>{cairnText('auth-generated.auth-screen-generated.your-world')}</Text>
          <Text style={styles.R2__line_1}>{cairnText('auth-generated.auth-screen-generated.you-ve-explored')}</Text>
          <Text style={styles.R2__km}>{cairnText('auth-generated.auth-screen-generated.12-6-km')}</Text>
          <Text style={styles.R2__loc}>{cairnText('auth-generated.auth-screen-generated.new-zealand')}</Text>
        </>
      )}
      {state === 'R3' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-icon-line-lock.png')} style={styles.R3__icon_lock} resizeMode="contain" />
          <Text style={styles.R3__title}>{cairnText('auth-generated.auth-screen-generated.session-expired')}</Text>
          <Text style={styles.R3__subtitle}>{cairnText('auth-generated.auth-screen-generated.please-sign-in-again')}</Text>
          <TouchableOpacity style={styles.R3__btn_signin} onPress={() => {}}>
            <Text style={styles.R3__btn_signin_label}>{cairnText('auth-generated.auth-screen-generated.sign-in')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'PR0' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.PR0__back}>{'‹'}</Text>
          <Text style={styles.PR0__plane}>{'✈'}</Text>
          <Text style={styles.PR0__title}>{cairnText('auth-generated.auth-screen-generated.reset-your-password')}</Text>
          <Text style={styles.PR0__subtitle}>{cairnText('auth-generated.auth-screen-generated.enter-your-email-and-we-ll-send')}</Text>
          <Text style={styles.PR0__label_email}>{cairnText('auth-generated.auth-screen-generated.email')}</Text>
          <View style={styles.PR0__field_email}>
            <Text style={styles.PR0__field_email__ph}>{cairnText('auth-generated.auth-screen-generated.name-example-com')}</Text>
          </View>
          <TouchableOpacity style={styles.PR0__btn_send} onPress={() => {}}>
            <Text style={styles.PR0__btn_send_label}>{cairnText('auth-generated.auth-screen-generated.send-reset-link')}</Text>
          </TouchableOpacity>
          <Text style={styles.PR0__back_link}>{cairnText('auth-generated.auth-screen-generated.back-to-sign-in')}</Text>
        </>
      )}
      {state === 'PR1' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.PR1__back}>{'‹'}</Text>
          <Image source={require('../../../assets/auth/o3-icon-line-mail.png')} style={styles.PR1__icon_mail} resizeMode="contain" />
          <Text style={styles.PR1__title}>{cairnText('auth-generated.auth-screen-generated.check-your-email')}</Text>
          <Text style={styles.PR1__subtitle}>{cairnText('auth-generated.auth-screen-generated.please-check-your-inbox')}</Text>
          <View style={styles.PR1__otp_1}>
          </View>
          <View style={styles.PR1__otp_2}>
          </View>
          <View style={styles.PR1__otp_3}>
          </View>
          <View style={styles.PR1__otp_4}>
          </View>
          <View style={styles.PR1__otp_5}>
          </View>
          <View style={styles.PR1__otp_6}>
          </View>
          <View style={styles.PR1__field_newp}>
            <Text style={styles.PR1__field_newp__ph}>{cairnText('auth-generated.auth-screen-generated.new-password')}</Text>
          </View>
          <View style={styles.PR1__field_conf}>
            <Text style={styles.PR1__field_conf__ph}>{cairnText('auth-generated.auth-screen-generated.confirm-password')}</Text>
          </View>
          <TouchableOpacity style={styles.PR1__btn_reset} onPress={() => {}}>
            <Text style={styles.PR1__btn_reset_label}>{cairnText('auth-generated.auth-screen-generated.reset-password')}</Text>
          </TouchableOpacity>
          <Text style={styles.PR1__back_link}>{cairnText('auth-generated.auth-screen-generated.back-to-sign-in')}</Text>
        </>
      )}
      {state === 'PR2' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.PR2__back}>{'‹'}</Text>
          <View style={styles.PR2__x_circle}>
            <Text style={styles.PR2__x_circle__x}>{'✕'}</Text>
          </View>
          <Text style={styles.PR2__title}>{cairnText('auth-generated.auth-screen-generated.invalid-code')}</Text>
          <Text style={styles.PR2__subtitle}>{cairnText('auth-generated.auth-screen-generated.please-check-your-inbox-and-try-again')}</Text>
          <Text style={styles.PR2__timer}>{cairnText('auth-generated.auth-screen-generated.records-created-in-0-00')}</Text>
          <TouchableOpacity style={styles.PR2__btn_back} onPress={() => {}}>
            <Text style={styles.PR2__btn_back_label}>{cairnText('auth-generated.auth-screen-generated.back-to-sign-in')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'OS0' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.OS0__cloud_off}>{'☁'}</Text>
          <Text style={styles.OS0__title}>{cairnText('auth-generated.auth-screen-generated.no-connection')}</Text>
          <Text style={styles.OS0__subtitle}>{cairnText('auth-generated.auth-screen-generated.please-check-your-internet-and-try-again')}</Text>
          <TouchableOpacity style={styles.OS0__btn_retry} onPress={() => {}}>
            <Text style={styles.OS0__btn_retry_label}>{cairnText('auth-generated.auth-screen-generated.try-again')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'OS1' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <Text style={styles.OS1__shield}>{'⛨'}</Text>
          <Text style={styles.OS1__title}>{cairnText('auth-generated.auth-screen-generated.sign-in-cancelled')}</Text>
          <Text style={styles.OS1__subtitle}>{cairnText('auth-generated.auth-screen-generated.you-can-try-another-method-or-try')}</Text>
          <TouchableOpacity style={styles.OS1__btn_back} onPress={() => {}}>
            <Text style={styles.OS1__btn_back_label}>{cairnText('auth-generated.auth-screen-generated.back-to-sign-in')}</Text>
          </TouchableOpacity>
        </>
      )}
      {state === 'OS2' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'paper' }} />
          <Image source={require('../../../assets/auth/o3-fern-tall.png')} style={styles.shared__fern_accent} resizeMode="contain" />
          <Image source={require('../../../assets/auth/o3-leaf-branch-tall.png')} style={styles.shared__leaf_accent} resizeMode="contain" />
          <View style={styles.OS2__check_circle}>
            <Text style={styles.OS2__check_circle__tick}>{'✓'}</Text>
          </View>
          <Text style={styles.OS2__title}>{cairnText('auth-generated.auth-screen-generated.success')}</Text>
          <Text style={styles.OS2__subtitle}>{cairnText('auth-generated.auth-screen-generated.you-re-good-to-go')}</Text>
        </>
      )}
    </View>
  );
}