import React, { PureComponent, createContext } from 'react';
import { Route, Switch, withRouter } from 'react-router-dom';
import 'moment-timezone/builds/moment-timezone-with-data.min.js';
import registerServices, { inject } from './services';
import getLoader from './components/loader';
import 'font-awesome/css/font-awesome.min.css';
import { Toast } from 'primereact/toast';
import 'primereact/resources/themes/bootstrap4-light-purple/theme.css';
import 'primereact/resources/primereact.min.css';
import 'primeicons/primeicons.css';
import 'jsd-report/build/css/style.css';
import './scss/style.scss';
import './App.scss';
import { getExtnLaunchUrl, validateIfWebApp } from './common/proxy';
import { getCurrentQueryParams } from './common/utils';

const isWebBuild = process.env.REACT_APP_WEB_BUILD === 'true';
export const extnAuth = isWebBuild && document.location.href.indexOf('?authType=1') > 0;

// Layout
const DefaultLayout = React.lazy(() => import('./layouts/DefaultLayout'));

// Pages
const IntegrateExtn = React.lazy(() => import('./views/pages/integrate/Integrate'));
const IntegrateWeb = isWebBuild && React.lazy(() => import('./views/pages/authenticate/ChooseAuthType'));

const Page401 = React.lazy(() => import('./views/pages/p401/Page401'));

export const AppContext = createContext({});

class App extends PureComponent {
  constructor(props) {
    super(props);
    this.state = { isLoading: true, needIntegration: false, authenticated: false };
  }

  componentDidMount() { this.beginInit(); }

  contextProps = {
    switchUser: (userId) => {
      let url = document.location.hash.substring(2);
      url = url.substring(url.indexOf("/"));
      url = `/${userId}${url}`;
      this.authenticateUser(url, true);
    },
    navigate: (url, userbased) => {
      this.props.history.push(userbased ? `/${this.$session.userId}${url}` : url);
    }
  };

  getMessanger = () => <Toast ref={(el) => this.messenger = el} baseZIndex={3000} />;

  async processOAuthForExtn(code) {
    registerServices('1'); // Register proxy services
    inject(this, 'JiraOAuthService', 'MessageService');
    const { success, message, userId: uid } = await this.$jAuth.integrate(code);
    if (success) {
      const url = await getExtnLaunchUrl(uid, this.$message);
      if (url) {
        window.location.href = url;
      } else {
        window.close();
      }
    } else {
      this.$message.error(message);
    }
  }

  async beginInit() {
    let authType;
    const { oauth, code, state } = getCurrentQueryParams();

    if (oauth) {
      if (state) {
        const { forWeb, authType: selAuthType } = JSON.parse(atob(state));
        if (forWeb && selAuthType) {
          authType = selAuthType;
          registerServices(authType || '1');
        } else if (!forWeb) {
          await this.processOAuthForExtn(code);
          return;
        }
      }
    }

    authType = await this.initWeb(authType, oauth);

    this.beginLoad(authType, oauth, code);
  }

  async initWeb(authType, oauth) {
    if (isWebBuild && !oauth) {
      authType = localStorage.getItem('authType');

      const newState = { authType };
      const pathname = this.props.location?.pathname;
      if ((!authType || authType === '1' || pathname === '/integrate') && await validateIfWebApp(newState)) {
        if (extnAuth && !authType && newState.authReady) {
          localStorage.setItem('authType', 1);
          authType = '1';
          newState.authType = '1';
        }
      }

      this.setState(newState);

      if (!authType || (authType === '1' && !newState.authReady)) {
        this.setState({ isLoading: false });
        this.props.history.push(`/integrate`);
        return;
      }
    }

    return authType;
  }

  authTypeChosen = (authType) => {
    localStorage.setItem('authType', authType);
    this.setState({ authType, needIntegration: false });
    this.props.history.push('/');
    this.beginLoad(authType);
  };

  async beginLoad(authType, oauth, code) {
    registerServices(authType || '1');
    inject(this, "AnalyticsService", "SessionService", "AuthService", "MessageService", "SettingsService", "CacheService", "JiraOAuthService");

    this.props.history.listen((location) => this.$analytics.trackPageView(location.pathname));

    this.$message.onNewMessage((message) => {
      let { detail } = message;
      if (detail && typeof detail !== 'string') {
        detail = detail.toString();
        message = { ...message, detail };
      }
      if (this.messenger) { this.messenger.show(message); }
    });

    await this.$settings.migrateSettings();

    if (oauth === 'jc') { // When Jira OAuth integration is done, save the user using authCode
      const { success, message, userId: uid } = await this.$jAuth.integrate(code);
      if (success) { // ToDo: if its extension handle it differently
        localStorage.setItem('authType', authType);
        document.location.href = `/${isWebBuild ? '' : 'index.html'}#/${uid}/dashboard/0`;
        return;
      } else {
        const newState = {};
        await validateIfWebApp(newState); // This function would not have got called as its a oauth request.
        this.setState(newState);
        this.$message.error(message, 'Jira Cloud Integration Failed');
      }
    }

    this.authenticateUser(this.props.location.pathname);
  }

  authenticateUser(pathname, forceNavigate) {
    const parts = pathname.split("/");
    let userId = parseInt(parts[1]);
    if (!userId || isNaN(userId) || pathname === '/401') {
      userId = null;
    }

    if (pathname.endsWith("/dashboard")) {
      forceNavigate = true;
      pathname += "/0"; // Load the default dashboard if their is no dashboard id in url
    }

    if (pathname.startsWith("/dashboard")) {
      forceNavigate = true;
    }

    if (parts[1] === "integrate") {
      this.setState({ isLoading: false });
    } else {
      this.tryAuthenticate(userId, pathname, forceNavigate);
    }
  }

  tryAuthenticate(userId, pathname, forceNavigate) {
    this.$auth.authenticate(userId).then((result) => {
      this.$analytics.trackPageView();

      if (result) {
        if (!pathname || pathname === "/") {
          this.props.history.push(`/${this.$session.userId}/dashboard/0`);
        }
        else if (forceNavigate) {
          if (pathname.startsWith("/dashboard")) {
            pathname = `/${this.$session.userId}${pathname}`;
          }
          this.props.history.push(pathname);
        }
        else if (!userId) {
          this.props.history.push(`/${this.$session.userId}${pathname}`);
        }
      }
      else {
        this.props.history.push(this.$session.needIntegration ? "/integrate" : "/401");
      }

      const sessionUser = this.$session.userId || null;
      this.setState({ isLoading: false, authenticated: result, jiraUrl: this.$session.rootUrl, userId: sessionUser });

    }, () => {
      this.props.history.push(this.$session.needIntegration ? "/integrate" : "/401");
      this.setState({ isLoading: false, needIntegration: this.$session.needIntegration, jiraUrl: this.$session.rootUrl });
    });
  }

  render() {
    const { isLoading, userId, isExtnValid, extnUnavailable, needIntegration, authType } = this.state;

    if (isLoading) {
      return <>{this.getMessanger()}{getLoader('Loading... Please wait...')}</>;
    }

    return (
      <>
        {this.getMessanger()}

        <AppContext.Provider value={this.contextProps}>
          <React.Suspense fallback={getLoader()}>
            <Switch>
              {isWebBuild && <Route exact path="/integrate" name="Authenticate Page" render={props => <IntegrateWeb {...props} isWebBuild={isWebBuild}
                isExtnValid={isExtnValid} extnUnavailable={extnUnavailable} needIntegration={needIntegration} onAuthTypeChosen={this.authTypeChosen} />} />}
              <Route exact path={isWebBuild ? "/integrate/extn" : "/integrate"} name="Integrate Page" render={props => <IntegrateExtn {...props} isWebBuild={isWebBuild} setAuthType={isWebBuild ? this.authTypeChosen : undefined} />} />
              <Route exact path="/401" name="Page 401" render={props => <Page401 {...props} jiraUrl={this.state.jiraUrl} />} />
              {(!isWebBuild || !!authType) && <Route key={userId} path="/:userId" name="Home" render={props => <DefaultLayout {...props} />} />}
            </Switch>
          </React.Suspense>
        </AppContext.Provider>
      </>
    );
  }
}

export default withRouter(App);
