import { getBlindTestTracks, getBlindTestScores, computeDistance, cleanValueLight, getSettings, setBlindTestTracks, setBlindTestScores, getTwitchOAuthToken } from "helpers"
import { useContext, useEffect, useState } from 'react'
import { launchTrack, pausePlayer, resumePlayer, setRepeatMode } from "../services/SpotifyAPI"
import { Button, FormControl } from "react-bootstrap"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { Guessable } from "./data/BlindTestData"
import { Client, Options } from "tmi.js"
import { BlindTestContext } from "App"

type DisplayableScoreType = {
  nick: string,
  rank?: number,
  score: number
};

type GuessType = {
  guessed: boolean,
  guessedBy?: string,
  points?: number
};

let twitchClient: Client | null = null;
let twitchCallback: (nick: string, msg: string) => void = () => { };

const DISPLAYED_USER_LIMIT = 70;

const BlindTestView = () => {

  
  const { setSubtitle } = useContext(BlindTestContext);

  const [bt] = useState(() => getBlindTestTracks());
  const [settings] = useState(() => getSettings());
  const [doneTracks, setDoneTracks] = useState(bt.doneTracks);
  const [scores, setScores] = useState(() => getBlindTestScores());
  const [leaderboardRows, setLeaderboardRows] = useState<DisplayableScoreType[]>([]);
  const [nickFilter, setNickFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [guesses, setGuesses] = useState<GuessType[]>([]);
  const [guessables, setGuessables] = useState<Guessable[]>([]);
  const [coverUri, setCoverUri] = useState('');

  useEffect(() => {
    twitchConnection(settings.twitchChannel, settings.chatNotifications);
    return () => {
      twitchDisconnection();
    }
  }, [settings.twitchChannel]);

  useEffect(() => {
    if (playing) {
      setSubtitle(`Playing song #${doneTracks} out of ${bt.tracks.length}`)
    } else if (bt.tracks.length - doneTracks > 0) {
      setSubtitle(`${bt.tracks.length - doneTracks} tracks left`);
    } else {
      setSubtitle('Blind-test is finished !');
    }
  }, [setSubtitle, bt.tracks.length, playing, doneTracks]);

  useEffect(() => {
    let flat: DisplayableScoreType[] = []
    let distinctScores: number[] = [];
    scores.forEach((_val: number, _key: string) => {
      flat.push({
        nick: _key,
        score: _val
      })
      if (!distinctScores.includes(_val)) {
        distinctScores.push(_val);
      }
    })
    distinctScores.sort((a, b) => b - a);
    flat.sort((a, b) => a.nick.localeCompare(b.nick))
    flat.sort((a, b) => b.score - a.score)
    if (nickFilter) {
      flat = flat.filter(s => s.nick.toLowerCase().includes(nickFilter));
    }
    // Display rank only for the first of each group
    for (let i = 0; i < flat.length; i++) {
      if (i === 0 || flat[i].score !== flat[i - 1].score) {
        flat[i].rank = 1 + distinctScores.indexOf(flat[i].score);
      }
    }
    setLeaderboardRows(flat);
  }, [nickFilter, scores]);

  const twitchConnection = (chan: string, chatNotifications: boolean) => {
    let opts: Options = {
      options: {
        skipUpdatingEmotesets: true
      },
      channels: [chan]
    };
    if (chatNotifications) {
      opts.identity = {
        username: 'foo',
        password: getTwitchOAuthToken() || ""
      }
    }
    twitchClient = new Client(opts);
    twitchClient.connect();
    twitchClient.on('message', (_channel: any, _tags: any, _message: any) => twitchCallback(_tags['display-name'], _message));
  }

  const twitchDisconnection = () => {
    if (twitchClient !== null) {
      twitchClient.disconnect();
    }
  }

  const backupState = () => {
    bt.doneTracks = doneTracks;
    setBlindTestTracks(bt);
    setBlindTestScores(scores);
  }

  const onProposition = (nick: string, message: string) => {
    addPlayerIfUnknown(nick);
    if (playing) {
      const proposition = cleanValueLight(message)
      for (let i = 0; i < guessables.length; i++) {
        const guess = guesses[i]
        if (guess.guessed) continue
        const guessable = guessables[i]
        const d = computeDistance(proposition, guessable.toGuess)
        if (d <= guessable.maxDistance || (proposition.includes(guessable.toGuess) && proposition.length <= 1.6 * guessable.toGuess.length)) {
          const points = 1 + (guesses.find((g) => g.guessed && g.guessedBy === nick) ? 1 : 0);
          addPointToPlayer(nick, points);
          updateGuessState(i, nick, points);
          twitchClient?.say(settings.twitchChannel, `✅ ${nick} correctly guessed [${guessable.toGuess}] +${points}`)
        }
      }
    }
  }
  twitchCallback = onProposition;

  const addPlayerIfUnknown = (nick: string) => {
    if (settings.addEveryUser && !scores.get(nick)) {
      addPointToPlayer(nick, 0)
    }
  }

  const addPointToPlayer = (nick: string, points: number) => {
    let newScores: Map<string, number> = new Map(scores)
    newScores.set(nick, (newScores.get(nick) || 0) + points)
    setScores(newScores);
  }

  const updateGuessState = (index: number, nick: string, points: number) => {
    let newGuesses = new Array<GuessType>()
    guesses.forEach((oldGuess: GuessType, i: number) => {
      if (i === index) {
        newGuesses.push({ guessed: true, guessedBy: nick, points: points })
      } else {
        newGuesses.push({ guessed: oldGuess.guessed, guessedBy: oldGuess.guessedBy, points: oldGuess.points })
      }
    })
    setGuesses(newGuesses);
  }

  const allGuessed = () => {
    return playing && guesses.reduce((prev, curr) => prev && curr.guessed, true)
  }

  const handleReveal = () => {
    backupState()
    let newGuesses = new Array<GuessType>()
    guesses.forEach((oldGuess: GuessType) => { newGuesses.push({ guessed: true, guessedBy: oldGuess.guessedBy, points: oldGuess.points }) })
    setGuesses(newGuesses);
  }

  const handlePause = () => {
    pausePlayer(settings.deviceId);
    setPaused(true);
  }

  const handleResume = () => {
    resumePlayer(settings.deviceId);
    setPaused(false);
  }

  const handleNextSong = async () => {
    backupState()
    let track = bt.tracks[doneTracks]
    setPlaying(false);
    setLoading(true);
    launchTrack(track.uri, track.offset, settings.deviceId).then(() => {
      setRepeatMode(true, settings.deviceId);
      setDoneTracks(doneTracks + 1);
      setGuessables([track.title, ...track.artists]);
      setGuesses(new Array(track.artists.length + 1).fill({ guessed: false }));
      setCoverUri(track.img);
      setPlaying(true);
      setPaused(false);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }

  const CrossEmoji = <FontAwesomeIcon color="#de281b" icon={['fas', 'times']} size="lg" />;
  const BubbleEmoji = <FontAwesomeIcon icon={['far', 'comment']} size="lg" />;
  const CheckEmoji = <FontAwesomeIcon color="#18ad1d" icon={['fas', 'check']} size="lg" />;

  const GuessableView = (props: any) => {
    const guessable: Guessable = props.guessable
    const guess: GuessType = props.guess
    if (guess.guessed) {
      return <div className="mb-3">
        <div className="bt-guess" title={guessable.toGuess}>{guess.guessedBy ? CheckEmoji : CrossEmoji} {guessable.original}</div>
        {guess.guessedBy && <div className="bt-gb">{BubbleEmoji} {guess.guessedBy} <b>[+{guess.points}]</b></div>}
      </div>
    } else {
      return <div className="mb-3">
        {CrossEmoji}<div className="bt-guess" style={{ fontWeight: 'bold' }}>&nbsp;?</div>
      </div>
    }
  }

  return (
    <div id="blindtest">
      <div className="row mb-4">
        <div className="col-md-8">
          <div className="p-3 mb-2 bt-left-panel border rounded-3" >
            <div id="cover" className="cover ">
              {allGuessed() &&
                <img id="cover-image" src={coverUri} alt="cover" />
              }
              {(playing || loading) && !allGuessed() &&
                <FontAwesomeIcon icon={['fas', 'question']} size="sm" />
              }
              {!playing && !loading &&
                <FontAwesomeIcon icon={['fas', 'volume-mute']} size="sm" />
              }
            </div>
            {playing &&
              <div style={{ flex: 1 }}>
                <div className="px-3 mb-2" >
                  <div className="bt-h">
                    <h2>TITLE</h2>
                  </div>
                  {playing &&
                    <div>
                      <GuessableView key="guess_0" guessable={guessables[0]} guess={guesses[0]} />
                    </div>
                  }
                </div>
                <div className="px-3 pt-3 mb-2" >
                  <div className="bt-h">
                    <h2>ARTIST(S)</h2>
                  </div>
                  {playing &&
                    <div>
                      {guessables.slice(1).map((guessable: Guessable, index: number) => {
                        return <GuessableView key={"guess_" + (index + 1)} guessable={guessable} guess={guesses[index + 1]} />
                      })}
                    </div>
                  }
                </div>
              </div>
            }
            {!playing &&
              <div style={{ margin: 'auto', color: 'grey' }}><i>Click NEXT to start playing</i></div>
            }
          </div>
        </div>
        <div className="col-md-4">
          <div id="player" className="mb-2 player" style={{ display: 'flex' }}>
            <Button className="col-sm" id="nextButton" disabled={loading || doneTracks >= bt.tracks.length} type="submit" variant="secondary" size="sm" onClick={handleNextSong} title="Next">
              <FontAwesomeIcon icon={['fas', 'step-forward']} color="#84BD00" size="sm" /> NEXT
            </Button>
            &nbsp;
            {
              paused &&
              <Button className="col-sm" id="resumeButton" disabled={!playing} type="submit" variant="secondary" size="sm" onClick={handleResume} title="Resume">
                <FontAwesomeIcon icon={['fas', 'play']} color="#84BD00" size="sm" /> RESUME
              </Button>
            }
            {
              !paused &&
              <Button className="col-sm" id="pauseButton" disabled={!playing} type="submit" variant="secondary" size="sm" onClick={handlePause} title="Pause">
                <FontAwesomeIcon icon={['fas', 'pause']} color="#84BD00" size="sm" /> PAUSE
              </Button>
            }
            &nbsp;
            <Button className="col-sm" id="revealButton" disabled={!playing || allGuessed()} type="submit" variant="secondary" size="sm" onClick={handleReveal} title="Reveal">
              <FontAwesomeIcon icon={['fas', 'eye']} color="#84BD00" size="sm" /> REVEAL
            </Button>
          </div>
          <div id="leaderboard" className="p-3 bt-panel border rounded-3">
            <FormControl value={nickFilter} className={"mb-2"} type="text" role="searchbox" placeholder="Nick filter" size="sm" onChange={(e) => setNickFilter(e.target.value.toLowerCase())} />
            <table className="table-hover bt-t">
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>#</th>
                  <th style={{ width: "55%" }}>Nick</th>
                  <th style={{ width: "12%" }}>Score</th>
                  <th style={{ width: "21%" }}></th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.slice(0, DISPLAYED_USER_LIMIT).map((sc) => {
                  return <tr key={sc.nick}>
                    <td>{sc.rank}</td>
                    <td>{sc.nick}</td>
                    <td>{sc.score}</td>
                    <td className="text-right">
                      <Button type="submit" variant="primary" size="sm" onClick={() => addPointToPlayer(sc.nick, -1)} className="text-nowrap">
                        <FontAwesomeIcon icon={['fas', 'minus']} size="sm" />
                      </Button>
                      &nbsp;
                      <Button type="submit" variant="primary" size="sm" onClick={() => addPointToPlayer(sc.nick, 1)} className="text-nowrap">
                        <FontAwesomeIcon icon={['fas', 'plus']} size="sm" />
                      </Button>
                    </td>
                  </tr>
                })}
                {leaderboardRows.length > DISPLAYED_USER_LIMIT &&
                  <tr style={{ textAlign: "center" }}>
                    <td colSpan={4}><span><i>...{leaderboardRows.length - DISPLAYED_USER_LIMIT} more players</i></span></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BlindTestView
